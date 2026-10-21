import { createTask, taskDetail } from "../lib/agent/service";
import { tickAgent } from "../lib/agent/runner";
import { closeSources } from "../lib/agent/sources";
import { normalize } from "../lib/service";
async function main() {
  const handle = normalize(process.argv[2] || "@alexandro_hideki").username;
  const kind = process.env.INSTAGRAM_SOURCE === "http" ? "http" : "browser";
  const taskId = createTask(
    `Проанализируй подписчиков @${handle}, найди 1 клиента из Москвы для fashion-съёмок Александра Хидеки. Изучи доступные публикации, подготовь три оффера и выбери лучший. Только подготовка, без отправки.`,
    kind,
  );
  console.log(
    `Task ${taskId}; source ${kind}; source account @${handle}. REAL mode: no fixture profiles, no sending.`,
  );
  let finished = false;
  try {
    for (let i = 0; i < 1000; i++) {
      await tickAgent();
      const task = taskDetail(taskId);
      const last = task.steps[0];
      console.log(
        `${task.status}: ${last?.tool || task.phase} — discovered ${task.counts.discovered}, prepared ${task.counts.prepared}`,
      );
      if (task.status === "blocked") {
        finished = true;
        console.error(task.error);
        process.exitCode = 2;
        break;
      }
      if (task.status === "completed") {
        finished = true;
        console.log(task.summary);
        for (const c of task.candidates.filter((c: any) => c.stage === "done"))
          console.log(
            JSON.stringify(
              {
                username: c.handle,
                source: c.source_handle,
                location: c.location_evidence,
                posts: c.posts,
                message: c.message_body,
                status: c.message_status,
              },
              null,
              2,
            ),
          );
        if (!task.counts.prepared) process.exitCode = 3;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!finished) {
      process.exitCode = 4;
      console.error(
        `Предел проверочного запуска достигнут. Задача ${taskId} сохранена для продолжения через интерфейс.`,
      );
    }
  } finally {
    await closeSources();
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
