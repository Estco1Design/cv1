import "./migration";
import { db, id, now, row, rows, insert, activity } from "../db";
import { intentSchema } from "./schema";
import { followup } from "./intent";
import { isAgency } from "./tools";
import { sourceStatus } from "./sources";
export function chat(taskId: string, role: "user" | "assistant", body: string) {
  insert("agent_chat_messages", {
    id: id(),
    task_id: taskId,
    role,
    body,
    created_at: now(),
  });
}
export function createTask(prompt: string, kind: "http" | "browser") {
  const taskId = id();
  db.transaction(() => {
    insert("agent_tasks", {
      id: taskId,
      prompt,
      source_kind: kind,
      created_at: now(),
      updated_at: now(),
    });
    chat(taskId, "user", prompt);
    chat(
      taskId,
      "assistant",
      "Задача сохранена. Worker разберёт запрос, проверит источник и начнёт сбор доступных подписчиков. Без доступа к данным работа остановится с объяснением.",
    );
    activity(null, "task_created", taskId);
  })();
  return taskId;
}
export function taskDetail(taskId: string) {
  const t = row("SELECT * FROM agent_tasks WHERE id=?", taskId);
  if (!t) throw new Error("Задача не найдена");
  const { cursor, lease_token, lease_until, ...safe } = t;
  return {
    ...safe,
    intent: t.intent ? JSON.parse(t.intent) : null,
    messages: rows(
      "SELECT * FROM agent_chat_messages WHERE task_id=? ORDER BY created_at,rowid",
      taskId,
    ),
    steps: rows(
      "SELECT * FROM agent_steps WHERE task_id=? ORDER BY started_at DESC,rowid DESC LIMIT 150",
      taskId,
    ).map((s) => ({
      ...s,
      input: JSON.parse(s.input),
      result: s.result ? JSON.parse(s.result) : null,
    })),
    candidates: rows(
      "SELECT c.*,l.blocked,l.opted_out,m.status AS message_status,m.body AS message_body,m.approved AS approved FROM agent_candidates c LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN outreach_messages m ON m.id=c.message_id WHERE c.task_id=? ORDER BY c.created_at,c.rowid",
      taskId,
    ).map((c) => {
      const { source_cursor, ...safe } = c;
      return {
        ...safe,
        profile: c.profile ? JSON.parse(c.profile) : null,
        posts: c.posts ? JSON.parse(c.posts) : [],
        assessment: c.assessment ? JSON.parse(c.assessment) : null,
        location_evidence: c.location_evidence
          ? JSON.parse(c.location_evidence)
          : null,
        generated: c.generated ? JSON.parse(c.generated) : null,
        selection: c.selection ? JSON.parse(c.selection) : null,
      };
    }),
    counts: counts(taskId),
  };
}
export function counts(taskId: string) {
  const c = rows(
    "SELECT stage,COUNT(*) n FROM agent_candidates WHERE task_id=? GROUP BY stage",
    taskId,
  );
  return {
    discovered: c.reduce((a, x) => a + x.n, 0),
    qualified: c
      .filter(
        (x) =>
          x.stage === "done" ||
          ["draft", "selection", "queue"].includes(x.stage),
      )
      .reduce((a, x) => a + x.n, 0),
    prepared: c.find((x) => x.stage === "done")?.n || 0,
    rejected: c
      .filter((x) => ["rejected", "error"].includes(x.stage))
      .reduce((a, x) => a + x.n, 0),
  };
}
export function agentState() {
  return {
    tasks: rows(
      "SELECT id,prompt,status,phase,source_handle,source_kind,error,summary,created_at,updated_at FROM agent_tasks ORDER BY created_at DESC,rowid DESC LIMIT 100",
    ).map((t) => ({ ...t, counts: counts(t.id) })),
    connections: sourceStatus(),
  };
}
export function taskControl(
  taskId: string,
  action: "pause" | "resume" | "stop",
) {
  db.transaction(() => {
    const t = row("SELECT * FROM agent_tasks WHERE id=?", taskId);
    if (!t) throw new Error("Задача не найдена");
    if (t.status === "completed" && action === "resume")
      throw new Error(
        "Задача завершена. Напишите «обработай ещё 20» для продолжения.",
      );
    const next =
      action === "pause" ? "paused" : action === "stop" ? "stopped" : "queued";
    db.prepare(
      "UPDATE agent_tasks SET status=?,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
    ).run(next, now(), taskId);
    db.prepare(
      "UPDATE agent_steps SET status='interrupted',finished_at=? WHERE task_id=? AND status='running'",
    ).run(now(), taskId);
    if (action !== "resume") {
      const unsent = rows(
        "SELECT m.id FROM outreach_messages m JOIN agent_candidates c ON c.message_id=m.id WHERE c.task_id=? AND m.status='queued'",
        taskId,
      );
      for (const m of unsent)
        db.prepare(
          "UPDATE outreach_messages SET status='awaiting_approval',approved=0,updated_at=? WHERE id=?",
        ).run(now(), m.id);
    }
    chat(
      taskId,
      "assistant",
      action === "resume"
        ? "Продолжаю с сохранённого контрольного шага."
        : action === "pause"
          ? "Задача на паузе. Незавершённый инструмент не сохранит результат; при RESUME шаг повторится. Неотправленные сообщения требуют нового подтверждения."
          : "Задача остановлена. Память и курсор сохранены. RESUME продолжит работу; начатую внешнюю отправку отозвать нельзя.",
    );
  })();
}
export function taskChat(taskId: string, text: string) {
  db.transaction(() => {
    const t = row("SELECT * FROM agent_tasks WHERE id=?", taskId);
    if (!t) throw new Error("Задача не найдена");
    chat(taskId, "user", text);
    const f = followup(text);
    if (f.type === "why") {
      const candidates = rows(
        "SELECT * FROM agent_candidates WHERE task_id=? AND assessment IS NOT NULL" +
          (f.handle ? " AND handle=?" : ""),
        ...[taskId, ...(f.handle ? [f.handle] : [])],
      );
      const c =
        candidates.length === 1
          ? candidates[0]
          : f.handle
            ? candidates[0]
            : null;
      if (!c) {
        chat(
          taskId,
          "assistant",
          "Укажите @username из результатов, например: «почему выбрал @brand?»",
        );
        return;
      }
      const a = JSON.parse(c.assessment);
      chat(
        taskId,
        "assistant",
        `@${c.handle}: ${a.rationale}\nГород: ${a.location.status}. ${a.location.reason}\n${a.location.evidence.map((e: any) => `${e.quote}\n${e.url}`).join("\n")}\nСкоринг: ${a.score}/100 (эвристика). ${c.rejection || "Причины и исходные публикации доступны в карточке."}`,
      );
      return;
    }
    if (!t.intent) {
      chat(
        taskId,
        "assistant",
        "Сначала завершите разбор исходной задачи. Для нового источника создайте новую задачу.",
      );
      return;
    }
    const intent = intentSchema.parse(JSON.parse(t.intent));
    if (f.type === "more") {
      intent.targetCount = Math.min(200, intent.targetCount + f.count);
      intent.maxProfiles = Math.min(
        2000,
        Math.max(intent.maxProfiles, intent.targetCount * 10),
      );
      db.prepare(
        "UPDATE agent_tasks SET intent=?,status='queued',phase='process',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
      ).run(JSON.stringify(intent), now(), taskId);
      chat(
        taskId,
        "assistant",
        `Новая цель: ${intent.targetCount} клиентов всего. Продолжаю с сохранённого курсора, уже обработанные контакты не повторяются. Если доступный список исчерпан, сообщу об этом.`,
      );
      return;
    }
    if (f.type === "exclude_agencies") {
      intent.excludedCategories = [
        ...new Set([...intent.excludedCategories, "агентства"]),
      ];
      for (const c of rows(
        "SELECT * FROM agent_candidates WHERE task_id=? AND profile IS NOT NULL",
        taskId,
      )) {
        const p = JSON.parse(c.profile),
          a = c.assessment ? JSON.parse(c.assessment) : {};
        if (isAgency(p, a.clientType)) {
          db.prepare(
            "UPDATE agent_candidates SET stage='rejected',rejection='Исключено оператором: агентство',updated_at=? WHERE id=?",
          ).run(now(), c.id);
          if (c.message_id)
            db.prepare(
              "UPDATE outreach_messages SET status='cancelled',approved=0,updated_at=? WHERE id=? AND status NOT IN ('sending','sent','sent_manual','delivery_unknown')",
            ).run(now(), c.message_id);
        }
      }
      chat(
        taskId,
        "assistant",
        "Агентства исключены из результатов и дальнейшего отбора. Их неотправленные сообщения отменены; выполненные отправки отозвать нельзя.",
      );
    } else if (f.type === "rewrite") {
      intent.offerInstructions = f.instructions;
      let n = 0;
      for (const c of rows(
        "SELECT c.*,m.status AS delivery FROM agent_candidates c LEFT JOIN outreach_messages m ON m.id=c.message_id WHERE c.task_id=? AND c.stage='done'",
        taskId,
      )) {
        if (
          [
            "sending",
            "sent",
            "sent_manual",
            "delivery_unknown",
            "cancelled",
          ].includes(c.delivery)
        )
          continue;
        db.prepare(
          "UPDATE agent_candidates SET stage='draft',generated=NULL,selection=NULL,updated_at=? WHERE id=?",
        ).run(now(), c.id);
        if (c.message_id)
          db.prepare(
            "UPDATE outreach_messages SET status='awaiting_approval',approved=0 WHERE id=?",
          ).run(c.message_id);
        n++;
      }
      chat(
        taskId,
        "assistant",
        `Перепишу офферы для ${n} неотправленных контактов. Ограничение: ${f.instructions}. Старое одобрение сброшено.`,
      );
    } else {
      chat(
        taskId,
        "assistant",
        "Поддерживаю команды: «почему выбрал @username?», «убери агентства», «обработай ещё 20», «переделай офферы без вопросов». Для другого аккаунта или города создайте новую задачу. Произвольное изменение цели без подтверждённых параметров не выполняю.",
      );
      return;
    }
    db.prepare(
      "UPDATE agent_tasks SET intent=?,status='queued',phase='process',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
    ).run(JSON.stringify(intent), now(), taskId);
  })();
}
export function approveTask(taskId: string, ids?: string[]) {
  return db.transaction(() => {
    const t = row("SELECT status FROM agent_tasks WHERE id=?", taskId);
    if (!t || ["paused", "stopped", "blocked", "failed"].includes(t.status))
      throw new Error("Сначала возобновите задачу и проверьте её ограничения");
    const candidates = rows(
      "SELECT c.*,m.status AS delivery,m.attempts,m.mode FROM agent_candidates c JOIN outreach_messages m ON m.id=c.message_id JOIN leads l ON l.id=c.lead_id WHERE c.task_id=? AND c.stage='done' AND l.blocked=0 AND l.opted_out=0 AND l.demo=0",
      taskId,
    );
    let n = 0;
    for (const c of candidates) {
      if (ids && !ids.includes(c.id)) continue;
      if (
        c.attempts ||
        ![
          "awaiting_approval",
          "draft",
          "manual_required",
          "provider_error",
        ].includes(c.delivery)
      )
        continue;
      db.prepare(
        "UPDATE outreach_messages SET approved=1,status=?,updated_at=? WHERE id=?",
      ).run(
        c.mode === "draft" ? "manual_required" : "queued",
        now(),
        c.message_id,
      );
      n++;
    }
    chat(
      taskId,
      "assistant",
      `Одобрено сообщений: ${n}. Автоматическая отправка возможна только через разрешённого провайдера и при отдельно включённой очереди; иначе используйте ручную передачу в CRM → Outreach.`,
    );
    activity(null, "task_approved", `${taskId}: ${n}`);
    return n;
  })();
}
