import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, row, rows, activity, id, now, insert } from "@/lib/db";
import {
  publicSettings,
  saveSettings,
  control,
  settings,
} from "@/lib/settings";
import {
  addLead,
  importCsv,
  demo,
  leadDetail,
  startJobs,
  agentAction,
  queueOffer,
} from "@/lib/service";
import { source } from "@/lib/providers";
import { completion } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.pathname.replace("/api/", "");
    if (p === "state") {
      const leads = rows("SELECT * FROM leads ORDER BY created_at DESC");
      return NextResponse.json({
        leads,
        jobs: rows(
          "SELECT j.*,l.username FROM agent_jobs j JOIN leads l ON l.id=j.lead_id ORDER BY j.created_at DESC LIMIT 100",
        ),
        messages: rows(
          "SELECT m.*,l.username,l.url,l.demo,l.blocked,l.opted_out FROM outreach_messages m JOIN leads l ON l.id=m.lead_id ORDER BY m.created_at DESC",
        ),
        activities: rows(
          "SELECT * FROM activities ORDER BY created_at DESC LIMIT 100",
        ),
        settings: publicSettings(),
        stats: {
          total: leads.length,
          qualified: leads.filter((l) => l.score >= settings().threshold)
            .length,
          offers: row("SELECT COUNT(*) n FROM offers").n,
          sent: row(
            "SELECT COUNT(*) n FROM outreach_messages WHERE status IN ('sent','sent_manual')",
          ).n,
          replies: row(
            "SELECT COUNT(DISTINCT lead_id) n FROM conversations WHERE direction='inbound'",
          ).n,
          negotiations: leads.filter((l) => l.outcome === "negotiation").length,
          sales: leads.filter((l) => l.outcome === "sale").length,
        },
        analytics: rows(
          "SELECT source,COUNT(*) total,AVG(score) avg_score,SUM(CASE WHEN outcome='sale' THEN 1 ELSE 0 END) sales FROM leads GROUP BY source",
        ),
      });
    }
    if (p.startsWith("leads/"))
      return NextResponse.json(leadDetail(p.slice(6)));
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host"))
      throw new Error("Cross-origin write blocked");
    if (Number(req.headers.get("content-length") || 0) > 2_000_000)
      throw new Error("Слишком большой запрос");
    const p = req.nextUrl.pathname.replace("/api/", ""),
      b = await req.json();
    let result: any = { ok: true };
    if (p === "import") {
      const input = z
        .object({
          url: z.string().max(2000).optional(),
          csv: z.string().max(1_000_000).optional(),
        })
        .parse(b);
      result = input.csv ? importCsv(input.csv) : addLead(input.url || "");
    } else if (p === "demo") result = demo();
    else if (p === "discover") {
      const filters = z
        .record(z.string(), z.string().max(500))
        .parse(b.filters);
      const profiles = await source.discover!(filters);
      let added = 0;
      for (const profile of profiles)
        if (
          !addLead("@" + profile.username, "provider", false, profile).duplicate
        )
          added++;
      result = { added };
    } else if (p === "settings") {
      const schema = z.object({
        provider: z.string().max(100),
        baseUrl: z.url(),
        model: z.string().min(1),
        analysisModel: z.string(),
        generationModel: z.string(),
        evaluationModel: z.string(),
        visionModel: z.string(),
        temperature: z.number().min(0).max(2),
        maxTokens: z.number().int().min(128).max(16000),
        apiStyle: z.enum(["auto", "chat", "responses"]),
        apiKey: z.string().optional(),
        profileKey: z.string().optional(),
        outreachKey: z.string().optional(),
        profileUrl: z.union([z.url(), z.literal("")]),
        outreachUrl: z.union([z.url(), z.literal("")]),
        mode: z.enum(["draft", "approval", "automated"]),
        minIntervalSeconds: z.number().int().min(60).max(86400),
        threshold: z.number().min(0).max(100),
        weights: z
          .array(z.number().min(0).max(100))
          .length(5)
          .refine((w) => w.reduce((a, c) => a + c, 0) > 0),
        knowledge: z.object({
          biography: z.string(),
          portfolio: z.string(),
          strengths: z.string(),
          shootTypes: z.string(),
          audience: z.string(),
          terms: z.string(),
          examples: z.string(),
          forbidden: z.string(),
        }),
      });
      saveSettings(schema.parse(b));
      activity(null, "settings_saved", "Настройки изменены");
    } else if (p === "ai-test") {
      await completion('Return JSON {"ok":true}. Connection test.', {});
      result = { ok: true, message: "AI endpoint ответил валидным JSON" };
    } else if (p === "agent") {
      const action = z
        .enum(["start", "pause", "resume", "stop"])
        .parse(b.action);
      if (action === "start" && b.leadId)
        startJobs([z.string().parse(b.leadId)]);
      else agentAction(action);
    } else if (p === "offer") {
      const input = z
        .object({ id: z.string(), body: z.string().min(1).max(2500) })
        .parse(b);
      const offer = row("SELECT * FROM offers WHERE id=?", input.id);
      if (!offer) throw new Error("Оффер не найден");
      db.transaction(() => {
        const message = row(
          "SELECT * FROM outreach_messages WHERE offer_id=?",
          input.id,
        );
        if (
          message &&
          ["sending", "sent", "sent_manual", "delivery_unknown"].includes(
            message.status,
          )
        )
          throw new Error("Отправленный текст нельзя изменить");
        db.prepare("UPDATE offers SET body=? WHERE id=?").run(
          input.body,
          input.id,
        );
        if (message)
          db.prepare(
            "UPDATE outreach_messages SET body=?,approved=0,status=?,updated_at=? WHERE id=?",
          ).run(
            input.body,
            message.mode === "draft" ? "draft" : "awaiting_approval",
            now(),
            message.id,
          );
        activity(offer.lead_id, "offer_edited", "Одобрение сброшено");
      })();
    } else if (p === "queue") {
      queueOffer(z.string().parse(b.offerId));
    } else if (p === "queue-control") {
      control({ queuePaused: z.boolean().parse(b.paused) });
      activity(null, "queue_control", b.paused ? "pause" : "resume");
    } else if (p === "message") {
      const input = z
        .object({
          id: z.string(),
          action: z.enum(["approve", "manual", "cancel"]),
        })
        .parse(b);
      db.transaction(() => {
        const m = row(
          "SELECT m.*,l.demo,l.blocked,l.opted_out FROM outreach_messages m JOIN leads l ON l.id=m.lead_id WHERE m.id=?",
          input.id,
        );
        if (!m) throw new Error("Сообщение не найдено");
        if (
          [
            "sent",
            "sent_manual",
            "sending",
            "delivery_unknown",
            "cancelled",
          ].includes(m.status)
        )
          throw new Error("Недопустимый переход статуса");
        if (m.demo || m.blocked || m.opted_out)
          throw new Error("Отправка запрещена");
        const status =
          input.action === "approve"
            ? m.mode === "draft"
              ? "manual_required"
              : "queued"
            : input.action === "manual"
              ? "sent_manual"
              : "cancelled";
        db.prepare(
          "UPDATE outreach_messages SET status=?,approved=?,updated_at=? WHERE id=?",
        ).run(status, input.action === "approve" ? 1 : 0, now(), m.id);
        if (input.action === "manual")
          db.prepare(
            "UPDATE leads SET status='contacted',updated_at=? WHERE id=?",
          ).run(now(), m.lead_id);
        activity(m.lead_id, "message_" + input.action, status);
      })();
    } else if (p === "lead") {
      const input = z
        .object({
          id: z.string(),
          blocked: z.boolean().optional(),
          opted_out: z.boolean().optional(),
          outcome: z.enum(["", "negotiation", "sale", "declined"]).optional(),
        })
        .parse(b);
      if (!row("SELECT id FROM leads WHERE id=?", input.id))
        throw new Error("Лид не найден");
      db.transaction(() => {
        for (const field of ["blocked", "opted_out", "outcome"] as const)
          if (input[field] !== undefined)
            db.prepare(
              `UPDATE leads SET ${field}=?,updated_at=? WHERE id=?`,
            ).run(
              typeof input[field] === "boolean"
                ? Number(input[field])
                : input[field],
              now(),
              input.id,
            );
        if (input.blocked || input.opted_out)
          db.prepare(
            "UPDATE outreach_messages SET status='cancelled',updated_at=? WHERE lead_id=? AND status NOT IN ('sending','sent','sent_manual','delivery_unknown')",
          ).run(now(), input.id);
        activity(input.id, "lead_updated", JSON.stringify(input));
      })();
    } else if (p === "reply") {
      const input = z
        .object({ leadId: z.string(), body: z.string().min(1).max(10000) })
        .parse(b);
      insert("conversations", {
        id: id(),
        lead_id: input.leadId,
        body: input.body,
        direction: "inbound",
        created_at: now(),
      });
      activity(input.leadId, "reply_logged", "Ответ добавлен вручную");
    } else return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    return fail(e);
  }
}
function fail(e: unknown) {
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Ошибка сервера" },
    { status: 400 },
  );
}
