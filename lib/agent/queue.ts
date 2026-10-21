import { row, rows, insert, id, now, db, activity } from "../db";
import type { TaskIntent } from "./schema";
export function queueMessage(
  taskId: string,
  candidate: any,
  intent: TaskIntent,
  generated: any,
  selection: any,
) {
  const lead = row(
    "SELECT blocked,opted_out FROM leads WHERE id=?",
    candidate.lead_id,
  );
  if (!lead || lead.blocked || lead.opted_out)
    return {
      skipped: true,
      reason: "Blacklist или отказ от контакта. Сообщение не создано.",
      messageId: null,
    };
  const existing = row(
    "SELECT * FROM outreach_messages WHERE lead_id=?",
    candidate.lead_id,
  );
  if (existing && existing.id !== candidate.message_id)
    return {
      skipped: true,
      reason:
        "Контакт уже имеет сообщение из другой задачи/CRM. Повторный outreach запрещён.",
      messageId: null,
    };
  if (
    existing &&
    (existing.attempts ||
      [
        "sending",
        "sent",
        "sent_manual",
        "delivery_unknown",
        "cancelled",
      ].includes(existing.status))
  )
    return {
      skipped: true,
      reason: "Отправка уже выполнялась либо закрыта; повтор запрещён.",
      messageId: existing.id,
    };
  db.prepare("UPDATE offers SET selected=0 WHERE lead_id=?").run(
    candidate.lead_id,
  );
  let best = "";
  for (const offer of generated.offers) {
    const offerId = id();
    insert("offers", {
      id: offerId,
      lead_id: candidate.lead_id,
      variant: offer.variant,
      body: offer.body,
      evaluation: JSON.stringify({
        detail: selection.evaluations.find(
          (e: any) => e.variant === offer.variant,
        ),
        selectionReason: selection.reason,
      }),
      selected: offer.variant === selection.selected ? 1 : 0,
      created_at: now(),
    });
    if (offer.variant === selection.selected) best = offerId;
  }
  if (!best) throw new Error("Выбранный оффер отсутствует");
  const selected = generated.offers.find(
    (o: any) => o.variant === selection.selected,
  );
  const messageId = existing?.id || id();
  const status =
    intent.outreachMode === "draft" ? "draft" : "awaiting_approval";
  if (existing)
    db.prepare(
      "UPDATE outreach_messages SET offer_id=?,body=?,mode=?,status=?,approved=0,error=NULL,updated_at=? WHERE id=?",
    ).run(best, selected.body, intent.outreachMode, status, now(), messageId);
  else
    insert("outreach_messages", {
      id: messageId,
      lead_id: candidate.lead_id,
      offer_id: best,
      body: selected.body,
      mode: intent.outreachMode,
      status,
      created_at: now(),
      updated_at: now(),
    });
  db.prepare("UPDATE leads SET status='queued',updated_at=? WHERE id=?").run(
    now(),
    candidate.lead_id,
  );
  activity(candidate.lead_id, "task_message_queued", taskId);
  return { skipped: false, messageId };
}
