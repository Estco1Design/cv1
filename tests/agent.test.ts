import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hideki-v2-test-"));
process.env.DATABASE_PATH = path.join(dir, "agent.sqlite");
process.env.INSTAGRAM_SESSION_DIR = path.join(dir, "no-session");
let failFollowers = false,
  offlineAI = false,
  calls: string[] = [],
  generation = 0,
  wrongHandle = false;
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw || "{}");
  res.setHeader("content-type", "application/json");
  const send = (value: unknown, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };
  if (req.url === "/profile/followers") {
    calls.push("followers:" + b.cursor);
    if (failFollowers) return send({}, 403);
    return send(
      b.cursor
        ? {
            handles: ["brand_moscow", "agency_moscow", "brand_two"],
            nextCursor: null,
            hasMore: false,
          }
        : {
            handles: ["brand_moscow", "personal", "brand_unknown"],
            nextCursor: "page2",
            hasMore: true,
          },
    );
  }
  if (req.url === "/profile") {
    const handle = new URL(b.url).pathname.split("/")[1];
    calls.push("profile:" + handle);
    return send({
      username: handle,
      name: "TEST ONLY " + handle,
      bio:
        handle === "brand_unknown"
          ? "Fashion brand; worldwide delivery"
          : handle === "personal"
            ? "Personal diary"
            : "Fashion brand based in Moscow",
      category: handle.includes("agency") ? "Model agency" : "Fashion brand",
      city: ["brand_moscow", "brand_two", "agency_moscow"].includes(handle)
        ? "Москва"
        : "",
      posts:
        handle === "personal"
          ? []
          : [
              {
                caption: "TEST ONLY: новая коллекция и студийная кампания.",
                url: "https://www.instagram.com/p/TEST_ONLY/",
                publishedAt: "2026-10-01T12:00:00Z",
              },
            ],
    });
  }
  if (req.url === "/v1/chat/completions") {
    if (offlineAI) return send({}, 503);
    const text = b.messages[0].content;
    const data = JSON.parse(text.split("DATA:\n")[1]);
    let answer: any = {};
    if (text.includes("Parse the operator"))
      answer = {
        sourceHandle: wrongHandle ? "invented_account" : "source_account",
        city: "Москва",
        targetCount: Number(
          data.operatorRequest.match(/найди\s+(\d+)/i)?.[1] || 2,
        ),
        maxProfiles: 100,
        excludedCategories: [],
        offerInstructions: "",
        outreachMode: "approval",
      };
    else if (text.includes("Assess candidate")) {
      const handle = data.profile.username;
      answer = {
        commercial: handle !== "personal",
        clientType: handle.includes("agency") ? "agency" : "fashion brand",
        location: {
          status: "confirmed",
          evidenceIds:
            handle === "brand_unknown" ? ["invented"] : ["business_city"],
          reason: "TEST ONLY location assessment",
        },
        observations: [
          { evidenceId: "post:0", quote: "TEST ONLY: новая коллекция" },
          { evidenceId: "post:999", quote: "Invented post" },
        ],
        rationale: "TEST ONLY public business signals",
      };
    } else if (text.includes("Analyze profile."))
      answer = {
        summary: "TEST ONLY brand",
        aesthetic: "По подписям, изображения не анализировались",
        need: "Кампания в тексте",
        proposal: "Fashion shoot",
        personalization: "Новая коллекция",
        facts: ["Подпись о коллекции"],
        hypotheses: ["Бюджет неизвестен"],
        confidence: "medium",
        dimensions: [1, 0.9, 0.7, 0.8, 0.8],
        evidence: [
          "Fashion bio",
          "Caption",
          "Text only",
          "Business profile",
          "Dated post",
        ],
      };
    else if (text.includes("Generate exactly")) {
      generation++;
      answer = {
        offers: ["A", "B", "C"].map((variant) => ({
          variant,
          body: `TEST ONLY ${generation}/${variant}. Съёмка новой коллекции. Обсудим концепцию лично.`,
        })),
      };
    } else if (text.includes("Independently evaluate"))
      answer = {
        evaluations: ["A", "B", "C"].map((variant) => ({
          variant,
          scores: [8, 8, 8, 8, 8, 8, 8],
          reason: "TEST ONLY score",
        })),
        selected: "A",
        reason: "TEST ONLY grounded selection",
      };
    return send({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    });
  }
  return send({}, 404);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const { db, row, rows } = await import("../lib/db");
const { control } = await import("../lib/settings");
const { createTask, taskDetail, taskControl, taskChat, approveTask } =
  await import("../lib/agent/service");
const { tickAgent } = await import("../lib/agent/runner");
const { localIntent, parseIntent } = await import("../lib/agent/intent");
const { verifiedLocation, evidenceFor } = await import("../lib/agent/tools");
const { BrowserInstagramSource } = await import("../lib/agent/browser-source");
const { dispatch } = await import("../lib/worker");
function reset() {
  db.exec(
    "DELETE FROM agent_steps; DELETE FROM agent_chat_messages; DELETE FROM agent_candidates; DELETE FROM agent_tasks; DELETE FROM conversations; DELETE FROM outreach_messages; DELETE FROM offers; DELETE FROM agent_jobs; DELETE FROM posts; DELETE FROM lead_assessments; DELETE FROM profile_snapshots; DELETE FROM leads; DELETE FROM ai_settings;",
  );
  control({
    profileUrl: base + "/profile",
    baseUrl: base + "/v1",
    queuePaused: true,
  });
  failFollowers = false;
  offlineAI = false;
  wrongHandle = false;
  calls = [];
  generation = 0;
}
function task(n = 2) {
  return createTask(
    `Проанализируй подписчиков @source_account, найди ${n} клиентов из Москвы для fashion-съёмок`,
    "http",
  );
}
async function finish(taskId: string, max = 90) {
  for (let i = 0; i < max; i++) {
    if (
      ["completed", "blocked"].includes(
        row("SELECT status FROM agent_tasks WHERE id=?", taskId).status,
      )
    )
      return taskDetail(taskId);
    await tickAgent();
  }
  throw new Error("Task did not terminate");
}
after(() => {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("typed Russian task intent, limits and explicit source; unavailable AI has labelled rule fallback", async () => {
  reset();
  const i = localIntent(
    "Изучи подписчиков https://www.instagram.com/source_account/, найди 30 клиентов из Москвы без агентств",
  );
  assert.equal(i?.sourceHandle, "source_account");
  assert.equal(i?.targetCount, 30);
  assert.deepEqual(i?.excludedCategories, ["агентства"]);
  assert.throws(() =>
    localIntent("Подписчики @brand найди 900 клиентов из Москвы"),
  );
  assert.equal(localIntent("Найди клиентов"), null);
  offlineAI = true;
  assert.equal(
    (await parseIntent("Изучи подписчиков @brand найди 3 клиентов из Москвы"))
      .parsedBy,
    "local_rules",
  );
  await assert.rejects(() => parseIntent("Найди клиентов"), /Укажите исходный/);
});
test("LLM cannot replace explicitly supplied source handle", async () => {
  reset();
  wrongHandle = true;
  const intent = await parseIntent(
    "Изучи подписчиков @real_brand найди 3 клиентов из Москвы",
  );
  assert.equal(intent.sourceHandle, "real_brand");
  assert.equal(intent.parsedBy, "local_rules");
});
test("Moscow evidence must be real; invented ids, hashtags and shipping do not qualify", () => {
  const e = [
    {
      id: "bio",
      kind: "bio" as const,
      quote: "Доставка в Москву и по всему миру",
      url: "https://www.instagram.com/test/",
    },
  ];
  assert.equal(
    verifiedLocation(
      { status: "confirmed", evidenceIds: ["bio"], reason: "x" },
      e,
      "Москва",
    ).status,
    "uncertain",
  );
  assert.equal(
    verifiedLocation(
      { status: "confirmed", evidenceIds: ["invented"], reason: "x" },
      e,
      "Москва",
    ).status,
    "uncertain",
  );
  assert.equal(
    verifiedLocation(
      { status: "confirmed", evidenceIds: ["bio"], reason: "x" },
      [{ ...e[0], quote: "#Москва #fashion" }],
      "Москва",
    ).status,
    "uncertain",
  );
  assert.equal(
    verifiedLocation(
      { status: "confirmed", evidenceIds: ["bio"], reason: "x" },
      [{ ...e[0], quote: "Fashion label based in Moscow" }],
      "Москва",
    ).status,
    "confirmed",
  );
});
test("real HTTP adapter pagination, profile/post/AI tools and three offers with independently selected draft", async () => {
  reset();
  const t = task();
  const result = await finish(t);
  assert.equal(result.status, "completed");
  assert.equal(result.counts.prepared, 2);
  assert.ok(calls.includes("followers:page2"));
  assert.equal(
    result.candidates.filter((c: any) => c.handle === "brand_moscow").length,
    1,
  );
  const prepared = result.candidates.find(
    (c: any) => c.handle === "brand_moscow",
  );
  assert.equal(prepared.location_evidence.status, "confirmed");
  assert.equal(prepared.posts[0].url, "https://www.instagram.com/p/TEST_ONLY/");
  assert.equal(prepared.generated.offers.length, 3);
  assert.equal(prepared.assessment.observations.length, 1);
  assert.equal(prepared.message_status, "awaiting_approval");
  assert.ok(
    result.candidates.some(
      (c: any) => c.handle === "brand_unknown" && c.stage === "rejected",
    ),
  );
  assert.equal(row("SELECT COUNT(*) n FROM outreach_messages").n, 2);
  assert.equal(
    result.steps.filter((s: any) => s.tool === "queueMessage").length,
    2,
  );
  assert.equal((result as any).cursor, undefined);
  assert.equal(prepared.source_cursor, undefined);
});
test("unavailable follower provider blocks at actual tool; resume preserves cursor and deduplicates", async () => {
  reset();
  failFollowers = true;
  const t = task(1);
  const blocked = await finish(t);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.counts.discovered, 0);
  assert.ok(blocked.error.includes("403"));
  assert.ok(
    blocked.steps.some(
      (s: any) => s.tool === "getFollowers" && s.status === "failed",
    ),
  );
  failFollowers = false;
  taskControl(t, "resume");
  const result = await finish(t);
  assert.equal(result.counts.prepared, 1);
  assert.equal(row("SELECT COUNT(*) n FROM outreach_messages").n, 1);
});
test("stop/resume and expired lease recover exact candidate checkpoint", async () => {
  reset();
  const t = task(1);
  for (let i = 0; i < 3; i++) await tickAgent();
  const before = calls.filter((c) => c === "profile:brand_moscow").length;
  taskControl(t, "stop");
  assert.equal(await tickAgent(), false);
  taskControl(t, "resume");
  db.prepare(
    "UPDATE agent_tasks SET status='running',lease_until=?,lease_token='crashed' WHERE id=?",
  ).run(Date.now() - 1, t);
  const result = await finish(t);
  assert.equal(result.counts.prepared, 1);
  assert.equal(
    calls.filter((c) => c === "profile:brand_moscow").length,
    before,
  );
  assert.equal(row("SELECT COUNT(*) n FROM outreach_messages").n, 1);
});
test("task memory: why, more, exclude agencies and rewrite without questions preserves message identity", async () => {
  reset();
  const t = task(1);
  await finish(t);
  const original = row("SELECT id FROM outreach_messages").id;
  taskChat(t, "почему выбрал @brand_moscow?");
  assert.match(taskDetail(t).messages.at(-1).body, /Скоринг/);
  taskChat(t, "обработай ещё 1");
  const two = await finish(t);
  assert.equal(two.counts.prepared, 2);
  taskChat(t, "убери агентства");
  await finish(t);
  const agency = taskDetail(t).candidates.find(
    (c: any) => c.handle === "agency_moscow",
  );
  assert.equal(agency.stage, "rejected");
  assert.equal(agency.message_status, "cancelled");
  taskChat(t, "переделай офферы без вопросов");
  const revised = await finish(t);
  const candidate = revised.candidates.find(
    (c: any) => c.handle === "brand_moscow",
  );
  assert.equal(candidate.message_id, original);
  assert.ok(!candidate.message_body.includes("?"));
  assert.equal(candidate.approved, 0);
  assert.ok(candidate.message_body.includes("TEST ONLY"));
});
test("bulk approval does not send; unsupported channel falls back and stopped task rejects approval", async () => {
  reset();
  const t = task(1);
  await finish(t);
  const m = row("SELECT * FROM outreach_messages");
  assert.equal(m.approved, 0);
  assert.equal(approveTask(t), 1);
  assert.equal(approveTask(t), 0);
  control({ queuePaused: false });
  await dispatch(m.id);
  assert.equal(
    row("SELECT status FROM outreach_messages").status,
    "manual_required",
  );
  taskControl(t, "stop");
  assert.throws(() => approveTask(t), /возобновите/);
  assert.equal(
    row("SELECT COUNT(*) n FROM outreach_messages WHERE status='sent'").n,
    0,
  );
});
test("cross-task duplicate contacts cannot produce a second outreach message", async () => {
  reset();
  const first = task(1);
  await finish(first);
  const leadId = row("SELECT lead_id FROM outreach_messages").lead_id;
  const second = task(1);
  const result = await finish(second);
  assert.equal(
    row("SELECT COUNT(*) n FROM outreach_messages WHERE lead_id=?", leadId).n,
    1,
  );
  assert.ok(
    result.candidates.some(
      (c: any) =>
        c.handle === "brand_moscow" && c.rejection.includes("другой задачи"),
    ),
  );
});
test("absent posts have no invented evidence; browser requires operator login and never fakes profiles", async () => {
  reset();
  const evidence = evidenceFor(
    {
      username: "x",
      name: "",
      bio: "",
      category: "",
      country: "",
      city: "",
      links: [],
      contacts: [],
      posts: [],
    },
    [],
  );
  assert.equal(evidence.length, 0);
  const b = new BrowserInstagramSource();
  await assert.rejects(
    () => b.getFollowers("alexandro_hideki", null, 1),
    /сессия не подключена/,
  );
  assert.equal(row("SELECT COUNT(*) n FROM leads").n, 0);
});

test("task stop cannot be bypassed by legacy CRM approval or stale queue state", async () => {
  reset();
  const t = task(1);
  await finish(t);
  approveTask(t);
  const m = row("SELECT id FROM outreach_messages");
  taskControl(t, "stop");
  db.prepare(
    "UPDATE outreach_messages SET status='queued',approved=1 WHERE id=?",
  ).run(m.id);
  control({ queuePaused: false });
  await dispatch(m.id);
  const message = row("SELECT * FROM outreach_messages WHERE id=?", m.id);
  assert.equal(message.status, "awaiting_approval");
  assert.equal(message.approved, 0);
  assert.equal(message.attempts, 0);
});
test("blacklisted contacts are rejected before source fetch", async () => {
  reset();
  const { addLead } = await import("../lib/service");
  const lead = addLead("@brand_moscow");
  db.prepare("UPDATE leads SET blocked=1 WHERE id=?").run(lead.id);
  const t = task(1);
  await finish(t);
  assert.ok(!calls.includes("profile:brand_moscow"));
  assert.ok(
    taskDetail(t).candidates.some(
      (c: any) =>
        c.handle === "brand_moscow" && c.rejection.includes("Blacklist"),
    ),
  );
});
