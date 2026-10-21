import { db, row, rows, insert, id, now, activity } from "./db";
import { settings, control } from "./settings";
import { source, demoProfile, outreach } from "./providers";
import { analyze, generate, evaluate } from "./ai";
import { snapshot, queueOffer } from "./service";
function taskAllowsDispatch(messageId: string) {
  if (
    !row(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_candidates'",
    )
  )
    return true;
  return !row(
    "SELECT t.id FROM agent_tasks t JOIN agent_candidates c ON c.task_id=t.id WHERE c.message_id=? AND t.status IN ('paused','stopped','blocked','failed') LIMIT 1",
    messageId,
  );
}
export async function dispatch(messageId: string) {
  const s = settings();
  if (s.queuePaused) throw new Error("Очередь приостановлена");
  const m = row(
    "SELECT m.*,l.url,l.demo,l.blocked,l.opted_out FROM outreach_messages m JOIN leads l ON l.id=m.lead_id WHERE m.id=?",
    messageId,
  );
  if (!m) throw new Error("Сообщение не найдено");
  if (m.status === "queued" && !taskAllowsDispatch(m.id)) {
    db.prepare(
      "UPDATE outreach_messages SET status='awaiting_approval',approved=0,error='Задача остановлена, приостановлена или заблокирована. Требуется возобновление и новое одобрение.',updated_at=? WHERE id=? AND status='queued'",
    ).run(now(), m.id);
    return;
  }
  if (m.demo || m.blocked || m.opted_out)
    throw new Error("Отправка запрещена: DEMO, блокировка или отказ");
  if (
    !["queued"].includes(m.status) ||
    m.mode === "draft" ||
    (m.mode === "approval" && !m.approved)
  )
    throw new Error("Сообщение не разрешено к отправке");
  if (Date.now() - s.lastDispatch < s.minIntervalSeconds * 1000)
    throw new Error("Лимит интенсивности: подождите");
  let cap;
  try {
    cap = await outreach.capabilities(m.url);
  } catch (error) {
    db.prepare(
      "UPDATE outreach_messages SET status='provider_error',error=?,updated_at=? WHERE id=? AND status='queued'",
    ).run((error as Error).message, now(), m.id);
    activity(m.lead_id, "capability_error", (error as Error).message);
    return;
  }
  if (!cap.allowed) {
    db.prepare(
      "UPDATE outreach_messages SET status='manual_required',error=?,updated_at=? WHERE id=? AND status='queued'",
    ).run(cap.reason || "Нет разрешения", now(), m.id);
    return;
  }
  const claimed = db.transaction(() => {
    const fresh = settings();
    const lead = row(
      "SELECT blocked,opted_out FROM leads WHERE id=?",
      m.lead_id,
    );
    if (
      !taskAllowsDispatch(m.id) ||
      fresh.queuePaused ||
      lead.blocked ||
      lead.opted_out ||
      Date.now() - fresh.lastDispatch < fresh.minIntervalSeconds * 1000
    )
      return false;
    const result = db
      .prepare(
        "UPDATE outreach_messages SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'",
      )
      .run(now(), m.id);
    if (result.changes) control({ lastDispatch: Date.now() });
    return !!result.changes;
  })();
  if (!claimed) return;
  try {
    const sent = await outreach.send(m.url, m.body, m.id);
    db.prepare(
      "UPDATE outreach_messages SET status='sent',provider_id=?,error=NULL,updated_at=? WHERE id=?",
    ).run(sent.id, now(), m.id);
    db.prepare(
      "UPDATE leads SET status='contacted',updated_at=? WHERE id=?",
    ).run(now(), m.lead_id);
    activity(m.lead_id, "sent", `Provider ID: ${sent.id}`);
  } catch (e) {
    db.prepare(
      "UPDATE outreach_messages SET status='delivery_unknown',error=?,updated_at=? WHERE id=?",
    ).run((e as Error).message, now(), m.id);
    activity(
      m.lead_id,
      "delivery_unknown",
      "Автоповтор отключён: проверьте статус у провайдера по idempotencyKey " +
        m.id,
    );
  }
}
export async function tick() {
  control({ workerHeartbeat: Date.now() });
  // SQLite serializes claims. Leases allow process-crash recovery; timeout exceeds bounded AI calls.
  db.prepare(
    "UPDATE outreach_messages SET status='delivery_unknown',error='Процесс прерван во время отправки; требуется сверка у провайдера' WHERE status='sending' AND updated_at < ?",
  ).run(new Date(Date.now() - 120000).toISOString());
  const s = settings();
  if (s.agent === "running") {
    const job = db.transaction(() => {
      const j = row(
        "SELECT * FROM agent_jobs WHERE status='queued' OR (status='running' AND lease_until < ?) ORDER BY created_at LIMIT 1",
        Date.now(),
      );
      if (!j) return;
      const leaseUntil = Date.now() + 180000;
      db.prepare(
        "UPDATE agent_jobs SET status='running',lease_until=?,updated_at=? WHERE id=?",
      ).run(leaseUntil, now(), j.id);
      return { ...j, lease_until: leaseUntil };
    })();
    if (job) {
      const checkpoint = job.step;
      try {
        const lead = row("SELECT * FROM leads WHERE id=?", job.lead_id);
        if (lead.blocked || lead.opted_out)
          throw new Error("Получатель исключён");
        let result: any;
        const latest = () => {
          const snap = row(
            "SELECT data FROM profile_snapshots WHERE lead_id=? ORDER BY created_at DESC LIMIT 1",
            lead.id,
          );
          if (!snap) throw new Error("Данные профиля отсутствуют");
          return JSON.parse(snap.data);
        };
        if (job.step === 0) {
          const p = lead.demo ? demoProfile : await source.fetch(lead.url);
          result = () => snapshot(lead.id, p);
        }
        if (job.step === 1) {
          const a = await analyze(latest(), !!lead.demo);
          result = () => {
            insert("lead_assessments", {
              id: id(),
              lead_id: lead.id,
              data: JSON.stringify(a),
              created_at: now(),
            });
            db.prepare(
              "UPDATE leads SET score=?,confidence=?,status='qualified',updated_at=? WHERE id=?",
            ).run(a.score, a.confidence, now(), lead.id);
          };
        }
        if (job.step === 2) {
          if (lead.score < settings().threshold) {
            result = () => {};
            job.step = 5;
          } else {
            const a = JSON.parse(
              row(
                "SELECT data FROM lead_assessments WHERE lead_id=? ORDER BY created_at DESC LIMIT 1",
                lead.id,
              ).data,
            );
            const generated = await generate(latest(), a, !!lead.demo);
            result = () => {
              for (const o of generated.offers)
                insert("offers", {
                  id: id(),
                  lead_id: lead.id,
                  variant: o.variant,
                  body: o.body,
                  evaluation: "{}",
                  created_at: now(),
                });
            };
          }
        }
        if (job.step === 3) {
          const offers = rows(
            "SELECT * FROM offers WHERE lead_id=? ORDER BY created_at DESC LIMIT 3",
            lead.id,
          );
          const evaluation = await evaluate(
            {
              offers: offers.map((o) => ({ variant: o.variant, body: o.body })),
              profile: latest(),
            },
            !!lead.demo,
          );
          result = () => {
            db.prepare("UPDATE offers SET selected=0 WHERE lead_id=?").run(
              lead.id,
            );
            for (const o of offers)
              db.prepare(
                "UPDATE offers SET evaluation=?,selected=? WHERE id=?",
              ).run(
                JSON.stringify({
                  detail: evaluation.evaluations.find(
                    (e) => e.variant === o.variant,
                  ),
                  selectionReason: evaluation.reason,
                }),
                o.variant === evaluation.selected ? 1 : 0,
                o.id,
              );
          };
        }
        if (job.step === 4) {
          result = () => {
            if (
              !row("SELECT id FROM outreach_messages WHERE lead_id=?", lead.id)
            )
              queueOffer(
                row(
                  "SELECT id FROM offers WHERE lead_id=? AND selected=1 ORDER BY created_at DESC LIMIT 1",
                  lead.id,
                ).id,
              );
          };
        }
        if (job.step === 5) result = () => {};
        db.transaction(() => {
          const current = row(
            "SELECT status,step,lease_until FROM agent_jobs WHERE id=?",
            job.id,
          );
          if (
            current.status !== "running" ||
            current.lease_until !== job.lease_until ||
            current.step !== checkpoint
          )
            return;
          result?.();
          const state = settings().agent;
          const next = job.step + 1;
          db.prepare(
            "UPDATE agent_jobs SET step=?,steps=?,status=?,lease_until=NULL,error=NULL,updated_at=? WHERE id=?",
          ).run(
            next,
            JSON.stringify({
              ...JSON.parse(job.steps),
              [job.step]: "completed",
            }),
            next >= 6
              ? "completed"
              : state === "paused"
                ? "paused"
                : state === "stopped"
                  ? "stopped"
                  : "queued",
            now(),
            job.id,
          );
          activity(lead.id, "agent_step", String(job.step + 1));
        })();
      } catch (e) {
        const failed = db
          .prepare(
            "UPDATE agent_jobs SET status='failed',error=?,lease_until=NULL,updated_at=? WHERE id=? AND status='running' AND lease_until=?",
          )
          .run((e as Error).message, now(), job.id, job.lease_until);
        if (!failed.changes) return;
        if (job.step === 0)
          db.prepare(
            "UPDATE leads SET status='source_error',updated_at=? WHERE id=?",
          ).run(now(), job.lead_id);
        activity(job.lead_id, "job_failed", (e as Error).message);
      }
    }
  }
  if (
    !settings().queuePaused &&
    Date.now() - settings().lastDispatch >= settings().minIntervalSeconds * 1000
  ) {
    const next = row(
      "SELECT id FROM outreach_messages WHERE status='queued' ORDER BY created_at LIMIT 1",
    );
    if (next)
      try {
        await dispatch(next.id);
      } catch (e) {
        activity(null, "dispatch_wait", (e as Error).message);
      }
  }
}
