import "./migration";
import { db, row, rows, id, now, insert, activity } from "../db";
import { addLead, snapshot } from "../service";
import { settings } from "../settings";
import { intentSchema, SourceBlocked } from "./schema";
import { parseIntent } from "./intent";
import { instagramSource } from "./sources";
import { toolsFor, type AgentTools, isAgency } from "./tools";
import { chat, counts } from "./service";
type ToolResult = {
  summary: unknown;
  commit: () => void;
  taskPatch?: {
    status?: string;
    phase?: string;
    summary?: string;
    exhausted?: number;
    cursor?: string | null;
    intent?: string;
    source_handle?: string;
  };
};
export async function tickAgent(injected?: AgentTools) {
  const task = db
    .transaction(() => {
      const t = row(
        "SELECT * FROM agent_tasks WHERE status='queued' OR (status='running' AND lease_until < ?) ORDER BY updated_at,id LIMIT 1",
        Date.now(),
      );
      if (!t) return;
      const token = id();
      db.prepare(
        "UPDATE agent_steps SET status='interrupted',finished_at=? WHERE task_id=? AND status='running'",
      ).run(now(), t.id);
      db.prepare(
        "UPDATE agent_tasks SET status='running',lease_token=?,lease_until=?,updated_at=? WHERE id=?",
      ).run(token, Date.now() + 300000, now(), t.id);
      return { ...t, lease_token: token };
    })
    .immediate();
  if (!task) return false;
  let toolName = "parseTask",
    candidate: any;
  let stepId = "";
  try {
    const intent = task.intent
      ? intentSchema.parse(JSON.parse(task.intent))
      : null;
    const tools = injected || toolsFor(instagramSource(task.source_kind));
    if (intent) {
      candidate = row(
        "SELECT * FROM agent_candidates WHERE task_id=? AND stage NOT IN ('done','rejected','error') ORDER BY created_at,rowid LIMIT 1",
        task.id,
      );
      toolName = candidate
        ? (
            {
              profile: "fetchProfile",
              posts: "fetchRecentPosts",
              analysis: "analyzeCandidate",
              draft: "draftOffers",
              selection: "selectOffer",
              queue: "queueMessage",
            } as Record<string, string>
          )[candidate.stage]
        : "getFollowers";
      if (counts(task.id).prepared >= intent.targetCount)
        toolName = "finishTask";
      if (
        !candidate &&
        (task.exhausted || counts(task.id).discovered >= intent.maxProfiles)
      )
        toolName = "finishTask";
    }
    stepId = id();
    insert("agent_steps", {
      id: stepId,
      task_id: task.id,
      candidate_id: candidate?.id || null,
      tool: toolName,
      status: "running",
      input: JSON.stringify({
        sourceHandle: task.source_handle || null,
        candidate: candidate?.handle || null,
        cursorPresent: !!task.cursor,
      }),
      started_at: now(),
    });
    let result: ToolResult;
    if (!intent) {
      const parsed = await parseIntent(task.prompt);
      result = {
        summary: parsed,
        taskPatch: {
          intent: JSON.stringify(parsed),
          source_handle: parsed.sourceHandle,
          phase: "collect",
        },
        commit() {
          chat(
            task.id,
            "assistant",
            `План: подписчики @${parsed.sourceHandle} → ${parsed.city} → до ${parsed.targetCount} клиентов, максимум ${parsed.maxProfiles} проверок. Только подтверждённые источником данные. ${parsed.parsedBy === "local_rules" ? "AI недоступен для разбора: применён ограниченный локальный разбор команды; анализ и офферы всё равно требуют настоящего AI." : "Запрос разобран AI."}`,
          );
        },
      };
    } else if (toolName === "finishTask") {
      const c = counts(task.id);
      const summary = `Подготовлено ${c.prepared} из ${intent.targetCount}. Найдено доступных: ${c.discovered}; исключено/ошибок: ${c.rejected}. ${c.prepared >= intent.targetCount ? "Цель достигнута." : task.exhausted ? "Доступный источнику список исчерпан. Полнота списка Instagram не гарантируется." : "Достигнут лимит проверяемых профилей. Для продолжения увеличьте цель командой «обработай ещё 20»."} Все сообщения ожидают проверки оператора.`;
      result = {
        summary: { ...c, reason: summary },
        taskPatch: { status: "completed", phase: "done", summary },
        commit() {
          chat(task.id, "assistant", summary);
        },
      };
    } else if (!candidate) {
      if (
        row(
          "SELECT COUNT(*) n FROM agent_steps WHERE task_id=? AND tool='getFollowers' AND status='completed'",
          task.id,
        ).n >= 200
      )
        throw new SourceBlocked(
          "Достигнут предел 200 страниц источника. Проверьте пагинацию поставщика; автоматический цикл остановлен.",
        );
      const page = await tools.getFollowers(
        intent.sourceHandle,
        task.cursor,
        Math.min(20, intent.maxProfiles - counts(task.id).discovered),
      );
      if (page.hasMore && (!page.nextCursor || page.nextCursor === task.cursor))
        throw new SourceBlocked(
          "Источник не продвинул курсор подписчиков. Задание остановлено, чтобы не повторять одну страницу бесконечно.",
        );
      result = {
        summary: {
          handles: page.handles,
          count: page.handles.length,
          hasMore: page.hasMore,
          limitation: page.limitation,
        },
        taskPatch: {
          phase: "process",
          cursor: page.nextCursor,
          exhausted: page.hasMore ? 0 : 1,
        },
        commit() {
          for (const handle of page.handles) {
            if (handle.toLowerCase() === intent.sourceHandle.toLowerCase())
              continue;
            db.prepare(
              "INSERT OR IGNORE INTO agent_candidates(id,task_id,handle,source_handle,source_cursor,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            ).run(
              id(),
              task.id,
              handle.toLowerCase(),
              intent.sourceHandle,
              task.cursor,
              now(),
              now(),
            );
          }
          if (page.limitation) chat(task.id, "assistant", page.limitation);
        },
      };
    } else {
      const update = (patch: Record<string, unknown>) => {
        const keys = Object.keys(patch);
        db.prepare(
          `UPDATE agent_candidates SET ${keys.map((k) => k + "=?").join(",")},error=NULL,updated_at=? WHERE id=?`,
        ).run(...Object.values(patch), now(), candidate.id);
      };
      if (candidate.stage === "profile") {
        const prior = row(
          "SELECT l.id,l.blocked,l.opted_out,m.id AS message_id FROM leads l LEFT JOIN outreach_messages m ON m.lead_id=l.id WHERE l.username=?",
          candidate.handle,
        );
        if (prior?.message_id || prior?.blocked || prior?.opted_out) {
          result = {
            summary: { skipped: "Existing outreach across tasks" },
            commit() {
              update({
                stage: "rejected",
                rejection:
                  prior.blocked || prior.opted_out
                    ? "Blacklist или отказ от контакта. Профиль не запрашивался."
                    : "Контакт уже в outreach из другой задачи/CRM. Повтор исключён.",
                lead_id: prior.id,
              });
            },
          };
        } else {
          const profile = await tools.fetchProfile(candidate.handle);
          if (profile.username.toLowerCase() !== candidate.handle.toLowerCase())
            throw new Error("Источник вернул другой профиль");
          result = {
            summary: {
              username: profile.username,
              bio: profile.bio,
              sourceUrl: "https://www.instagram.com/" + profile.username + "/",
              postsNotYetAnalyzed: true,
            },
            commit() {
              const lead = addLead(
                "@" + candidate.handle,
                "followers:" + intent.sourceHandle,
                false,
              );
              update({
                profile: JSON.stringify(profile),
                lead_id: lead.id,
                stage: "posts",
              });
            },
          };
        }
      } else if (candidate.stage === "posts") {
        const profile = JSON.parse(candidate.profile);
        const posts = await tools.fetchRecentPosts(candidate.handle, profile);
        result = {
          summary: {
            posts: posts.map((p) => ({
              caption: p.caption,
              url: p.url || null,
              date: p.publishedAt || null,
            })),
            count: posts.length,
            limitation: posts.length
              ? "Only provider-accessible posts"
              : "Публикации недоступны. Не будут выдуманы.",
          },
          commit() {
            const full = { ...profile, posts };
            snapshot(candidate.lead_id, full);
            update({
              profile: JSON.stringify(full),
              posts: JSON.stringify(posts),
              stage: "analysis",
            });
          },
        };
      } else if (candidate.stage === "analysis") {
        const profile = JSON.parse(candidate.profile);
        const assessment = await tools.analyzeCandidate(
          profile,
          JSON.parse(candidate.posts || "[]"),
          intent,
        );
        const excluded =
          intent.excludedCategories.some((x) => /агентств|agenc/i.test(x)) &&
          isAgency(profile, assessment.clientType);
        const reason = excluded
          ? "Исключено: агентство"
          : !assessment.commercial
            ? "Нет подтверждённого коммерческого соответствия"
            : assessment.location.status !== "confirmed"
              ? "Москва/целевой город не подтверждены публичными данными"
              : assessment.score < settings().threshold
                ? "Скоринг ниже порога"
                : null;
        result = {
          summary: assessment,
          commit() {
            insert("lead_assessments", {
              id: id(),
              lead_id: candidate.lead_id,
              data: JSON.stringify(assessment),
              created_at: now(),
            });
            db.prepare(
              "UPDATE leads SET score=?,confidence=?,status=?,updated_at=? WHERE id=?",
            ).run(
              assessment.score,
              assessment.confidence,
              reason ? "low_priority" : "qualified",
              now(),
              candidate.lead_id,
            );
            update({
              assessment: JSON.stringify(assessment),
              location_evidence: JSON.stringify(assessment.location),
              score: assessment.score,
              stage: reason ? "rejected" : "draft",
              rejection: reason,
            });
          },
        };
      } else if (candidate.stage === "draft") {
        const generated = await tools.draftOffers(
          JSON.parse(candidate.profile),
          JSON.parse(candidate.assessment),
          intent,
        );
        result = {
          summary: generated,
          commit() {
            update({
              generated: JSON.stringify(generated),
              stage: "selection",
            });
          },
        };
      } else if (candidate.stage === "selection") {
        const selection = await tools.selectOffer({
          offers: JSON.parse(candidate.generated).offers,
          profile: JSON.parse(candidate.profile),
          assessment: JSON.parse(candidate.assessment),
          operatorInstructions: intent.offerInstructions,
        });
        result = {
          summary: selection,
          commit() {
            update({ selection: JSON.stringify(selection), stage: "queue" });
          },
        };
      } else if (candidate.stage === "queue") {
        result = {
          summary: { action: "Prepare reviewed message; do not send" },
          commit() {
            const queued = tools.queueMessage(
              task.id,
              candidate,
              intent,
              JSON.parse(candidate.generated),
              JSON.parse(candidate.selection),
            );
            update({
              stage: queued.skipped ? "rejected" : "done",
              message_id: queued.messageId,
              rejection: queued.skipped ? queued.reason : null,
            });
          },
        };
      } else throw new Error("Неизвестный контрольный шаг");
    }
    db.transaction(() => {
      const current = row(
        "SELECT status,lease_token FROM agent_tasks WHERE id=?",
        task.id,
      );
      if (
        current.status !== "running" ||
        current.lease_token !== task.lease_token
      )
        return;
      result.commit();
      db.prepare(
        "UPDATE agent_steps SET status='completed',result=?,finished_at=? WHERE id=?",
      ).run(JSON.stringify(result.summary), now(), stepId);
      const patch = {
        status: "queued",
        ...result.taskPatch,
        lease_token: null,
        lease_until: null,
        error: null,
        updated_at: now(),
      };
      const keys = Object.keys(patch);
      db.prepare(
        `UPDATE agent_tasks SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
      ).run(...Object.values(patch), task.id);
    }).immediate();
  } catch (e) {
    db.transaction(() => {
      const current = row(
        "SELECT status,lease_token FROM agent_tasks WHERE id=?",
        task.id,
      );
      if (
        current.status !== "running" ||
        current.lease_token !== task.lease_token
      )
        return;
      const error = (e as Error).message;
      if (stepId)
        db.prepare(
          "UPDATE agent_steps SET status='failed',error=?,finished_at=? WHERE id=?",
        ).run(error, now(), stepId);
      const perProfile =
        candidate &&
        ["profile", "posts"].includes(candidate.stage) &&
        !(e instanceof SourceBlocked);
      if (perProfile) {
        db.prepare(
          "UPDATE agent_candidates SET stage='error',error=?,updated_at=? WHERE id=?",
        ).run(error, now(), candidate.id);
        db.prepare(
          "UPDATE agent_tasks SET status='queued',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
        ).run(now(), task.id);
      } else {
        db.prepare(
          "UPDATE agent_tasks SET status='blocked',error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
        ).run(error, now(), task.id);
        chat(
          task.id,
          "assistant",
          `Работа остановлена на инструменте ${toolName}: ${error}\nИсправьте подключение или данные и нажмите RESUME. Курсор и завершённые шаги сохранены.`,
        );
      }
      activity(
        candidate?.lead_id || null,
        "task_tool_error",
        `${toolName}: ${error}`,
      );
    }).immediate();
  }
  return true;
}
