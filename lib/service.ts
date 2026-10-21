import Papa from "papaparse";
import { db, id, now, row, rows, insert, activity } from "./db";
import { demoProfile, source, Profile } from "./providers";
import { control, settings } from "./settings";
export function normalize(input: string) {
  let u: URL;
  try {
    u = new URL(
      input.trim().startsWith("@")
        ? "https://www.instagram.com/" + input.trim().slice(1)
        : input.trim(),
    );
  } catch {
    throw new Error("Нужен Instagram URL или @username");
  }
  const username = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (
    !["instagram.com", "www.instagram.com"].includes(u.hostname) ||
    !username ||
    !/^[a-z0-9._]{1,30}$/.test(username) ||
    ["p", "reel", "reels", "stories", "explore", "direct", "accounts"].includes(
      username,
    )
  )
    throw new Error("Некорректный URL профиля Instagram");
  return { url: `https://www.instagram.com/${username}/`, username };
}
export function addLead(
  input: string,
  origin = "manual",
  demo = false,
  profile?: Profile,
) {
  const n = normalize(input);
  const existing = row("SELECT * FROM leads WHERE url=?", n.url);
  if (existing) {
    if (profile && !!existing.demo === demo) snapshot(existing.id, profile);
    return { id: existing.id, duplicate: true };
  }
  const leadId = id();
  db.transaction(() => {
    insert("leads", {
      id: leadId,
      ...n,
      name: profile?.name || "",
      category: profile?.category || "",
      source: origin,
      demo: demo ? 1 : 0,
      created_at: now(),
      updated_at: now(),
    });
    if (profile) snapshot(leadId, profile);
    activity(leadId, "imported", demo ? "DEMO профиль" : origin);
  })();
  return { id: leadId, duplicate: false };
}
export function snapshot(leadId: string, p: Profile) {
  const sid = id();
  insert("profile_snapshots", {
    id: sid,
    lead_id: leadId,
    data: JSON.stringify(p),
    created_at: now(),
  });
  for (const post of p.posts)
    insert("posts", { id: id(), snapshot_id: sid, data: JSON.stringify(post) });
  db.prepare(
    "UPDATE leads SET name=?,category=?,status='profile_ready',updated_at=? WHERE id=?",
  ).run(p.name, p.category, now(), leadId);
}
export function importCsv(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.length)
    throw new Error("CSV: " + parsed.errors.map((e) => e.message).join("; "));
  if (
    !parsed.meta.fields?.some((f) =>
      ["url", "instagram_url", "username"].includes(f),
    )
  )
    throw new Error("CSV требует колонку url, instagram_url или username");
  if (parsed.data.length > 1000)
    throw new Error("Максимум 1000 строк за импорт");
  let added = 0,
    duplicates = 0;
  const errors: string[] = [];
  parsed.data.forEach((r, i) => {
    try {
      const value =
        r.url ||
        r.instagram_url ||
        (r.username ? "@" + r.username.replace(/^@/, "") : "");
      const result = addLead(value, "csv");
      result.duplicate ? duplicates++ : added++;
    } catch (e) {
      errors.push(`Строка ${i + 2}: ${(e as Error).message}`);
    }
  });
  return { added, duplicates, errors };
}
export function demo() {
  return addLead("@" + demoProfile.username, "demo", true, demoProfile);
}
export function leadDetail(leadId: string) {
  const lead = row("SELECT * FROM leads WHERE id=?", leadId);
  if (!lead) throw new Error("Лид не найден");
  return {
    ...lead,
    snapshots: rows(
      "SELECT * FROM profile_snapshots WHERE lead_id=? ORDER BY created_at DESC",
      leadId,
    ).map((x) => ({ ...x, data: JSON.parse(x.data) })),
    assessments: rows(
      "SELECT * FROM lead_assessments WHERE lead_id=? ORDER BY created_at DESC",
      leadId,
    ).map((x) => ({ ...x, data: JSON.parse(x.data) })),
    offers: rows(
      "SELECT * FROM offers WHERE lead_id=? ORDER BY created_at DESC",
      leadId,
    ),
    activities: rows(
      "SELECT * FROM activities WHERE lead_id=? ORDER BY created_at DESC",
      leadId,
    ),
    conversations: rows(
      "SELECT * FROM conversations WHERE lead_id=? ORDER BY created_at DESC",
      leadId,
    ),
  };
}
export const steps = [
  "Получение профиля",
  "Анализ и скоринг",
  "Три оффера",
  "Независимая оценка",
  "Очередь отправки",
  "Доступное действие",
];
export function startJobs(leadIds?: string[]) {
  let count = 0;
  db.transaction(() => {
    for (const lead of rows(
      "SELECT * FROM leads WHERE blocked=0 AND opted_out=0 AND outcome NOT IN ('sale','declined')",
    )) {
      if (leadIds && !leadIds.includes(lead.id)) continue;
      if (
        row("SELECT id FROM outreach_messages WHERE lead_id=?", lead.id) ||
        row(
          "SELECT id FROM agent_jobs WHERE lead_id=? AND status IN ('queued','running','paused','failed','completed')",
          lead.id,
        )
      )
        continue;
      insert("agent_jobs", {
        id: id(),
        lead_id: lead.id,
        status: "queued",
        created_at: now(),
        updated_at: now(),
      });
      count++;
    }
    control({ agent: "running" });
    activity(null, "agent_start", `Добавлено заданий: ${count}`);
  })();
  return count;
}
export function agentAction(action: string) {
  db.transaction(() => {
    if (action === "start") {
      startJobs();
      return;
    }
    if (action === "pause") {
      control({ agent: "paused" });
      db.prepare(
        "UPDATE agent_jobs SET status='paused',updated_at=? WHERE status='queued'",
      ).run(now());
    } else if (action === "resume") {
      control({ agent: "running" });
      db.prepare(
        "UPDATE agent_jobs SET status='queued',error=NULL,updated_at=? WHERE status IN ('paused','failed')",
      ).run(now());
    } else if (action === "stop") {
      control({ agent: "stopped" });
      db.prepare(
        "UPDATE agent_jobs SET status='stopped',updated_at=? WHERE status IN ('queued','paused','running')",
      ).run(now());
    } else throw new Error("Неизвестная команда");
    activity(null, "agent_" + action, "Управление агентом");
  })();
}
export function queueOffer(offerId: string) {
  return db.transaction(() => {
    const offer = row("SELECT * FROM offers WHERE id=?", offerId);
    if (!offer) throw new Error("Оффер не найден");
    const lead = row("SELECT * FROM leads WHERE id=?", offer.lead_id);
    if (lead.blocked || lead.opted_out)
      throw new Error("Получатель заблокирован или отказался");
    const existing = row(
      "SELECT * FROM outreach_messages WHERE lead_id=?",
      lead.id,
    );
    if (existing) {
      if (
        existing.attempts > 0 ||
        [
          "sending",
          "sent",
          "sent_manual",
          "delivery_unknown",
          "cancelled",
        ].includes(existing.status)
      )
        throw new Error(
          "Для этого контакта отправка уже выполнялась или была закрыта. Повтор запрещён.",
        );
      if (existing.offer_id === offer.id && existing.body === offer.body)
        return;
      const status = lead.demo
        ? "demo_draft"
        : existing.mode === "draft"
          ? "draft"
          : existing.mode === "approval"
            ? "awaiting_approval"
            : "queued";
      db.prepare(
        "UPDATE outreach_messages SET offer_id=?,body=?,status=?,approved=0,error=NULL,updated_at=? WHERE id=?",
      ).run(offer.id, offer.body, status, now(), existing.id);
      activity(
        lead.id,
        "queued_offer_replaced",
        "Выбран другой оффер; одобрение сброшено, ID сообщения сохранён",
      );
      return;
    }
    const mode = settings().mode;
    insert("outreach_messages", {
      id: id(),
      lead_id: lead.id,
      offer_id: offer.id,
      body: offer.body,
      mode,
      status: lead.demo
        ? "demo_draft"
        : mode === "draft"
          ? "draft"
          : mode === "approval"
            ? "awaiting_approval"
            : "queued",
      created_at: now(),
      updated_at: now(),
    });
    db.prepare("UPDATE leads SET status='queued',updated_at=? WHERE id=?").run(
      now(),
      lead.id,
    );
    activity(lead.id, "queued", mode);
  })();
}
