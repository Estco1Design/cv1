import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hideki-tests-"));
process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
process.env.SETTINGS_ENCRYPTION_KEY = "a".repeat(64);
let sends = 0,
  capability = true,
  failSource = false,
  responseOnly = false,
  failSend = false,
  capturedResponseInput: any;
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw || "{}");
  res.setHeader("content-type", "application/json");
  if (req.url === "/profile") {
    if (failSource) {
      res.statusCode = 503;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        username: new URL(b.url).pathname.split("/")[1],
        name: "Test brand",
        bio: "Fashion collection",
        posts: [],
      }),
    );
  } else if (req.url === "/outreach/capabilities")
    res.end(
      JSON.stringify({
        allowed: capability,
        reason: "No permitted recipient route",
      }),
    );
  else if (req.url === "/outreach/send") {
    sends++;
    if (failSend) {
      res.statusCode = 502;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify({ id: b.idempotencyKey }));
  } else if (req.url === "/v1/responses") {
    capturedResponseInput = b.input;
    res.end(
      JSON.stringify({
        output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }],
      }),
    );
  } else if (req.url === "/v1/chat/completions") {
    if (responseOnly) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    const prompt = b.messages[0].content;
    const text = typeof prompt === "string" ? prompt : prompt[0].text;
    let answer: any = { ok: true };
    if (text.includes("Analyze profile."))
      answer = {
        summary: "Fashion brand",
        aesthetic: "Unknown",
        need: "Unknown",
        proposal: "Discuss shoot",
        personalization: "Fashion collection",
        facts: ["Bio says fashion"],
        hypotheses: ["Budget unknown"],
        confidence: "high",
        dimensions: [1, 0.6, 0, 0.5, 0],
        evidence: [
          "Bio",
          "Hypothesis",
          "No photos",
          "Unknown budget",
          "No posts",
        ],
      };
    if (text.includes("Generate exactly"))
      answer = {
        offers: ["A", "B", "C"].map((variant) => ({
          variant,
          body: `${variant}: Fashion collection. Discuss shoot?`,
        })),
      };
    if (text.includes("Independently evaluate"))
      answer = {
        evaluations: ["A", "B", "C"].map((variant) => ({
          variant,
          scores: [7, 8, 7, 8, 9, 8, 7],
          reason: "Grounded in bio",
        })),
        selected: "A",
        reason: "Clear and relevant",
      };
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
    );
  } else {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const { db, row, rows } = await import("../lib/db");
const { control, saveSettings, settings, publicSettings } =
  await import("../lib/settings");
const {
  importCsv,
  addLead,
  normalize,
  startJobs,
  agentAction,
  demo,
  queueOffer,
} = await import("../lib/service");
const { tick, dispatch } = await import("../lib/worker");
const { score, analyze, completion } = await import("../lib/ai");
const { source } = await import("../lib/providers");
function reset() {
  db.exec(
    "DELETE FROM conversations; DELETE FROM outreach_messages; DELETE FROM offers; DELETE FROM agent_jobs; DELETE FROM posts; DELETE FROM lead_assessments; DELETE FROM profile_snapshots; DELETE FROM leads; DELETE FROM activities; DELETE FROM ai_settings;",
  );
  control({
    baseUrl: base + "/v1",
    profileUrl: base + "/profile",
    outreachUrl: base + "/outreach",
    threshold: 30,
    minIntervalSeconds: 60,
    queuePaused: true,
    agent: "stopped",
  });
  sends = 0;
  capability = true;
  failSource = false;
  responseOnly = false;
  failSend = false;
  capturedResponseInput = undefined;
}
after(() => {
  server.close();
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
test("CSV quoting, errors, normalized deduplication", () => {
  reset();
  const result = importCsv(
    'url,name\nhttps://instagram.com/Brand/?utm=x,"Brand, Co"\nhttps://www.instagram.com/brand/,dup\nnot-a-url,bad',
  );
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(normalize("@BRAND").username, "brand");
  assert.throws(() => normalize("https://evil.test/brand/"));
  assert.throws(() => importCsv("name\nbrand"));
});
test("score normalizes editable weights and bounds", () => {
  assert.equal(score([1, 1, 1, 1, 1], [25, 25, 20, 15, 15]), 100);
  assert.equal(score([0, 0, 0, 0, 0], [1, 1, 1, 1, 1]), 0);
  assert.equal(score([1, 0, 0, 0, 0], [1, 1, 1, 1, 1]), 20);
  assert.throws(() => score([1, 1, 1, 1, 1], [0, 0, 0, 0, 0]));
});
test("missing posts force low confidence and text-only limitation", async () => {
  reset();
  const a = await analyze({
    username: "test",
    name: "",
    bio: "Fashion",
    category: "",
    country: "",
    city: "",
    links: [],
    contacts: [],
    posts: [],
  });
  assert.equal(a.confidence, "low");
  assert.equal(a.mediaAccess, "text_only");
  assert.ok(a.limitation.includes("не анализировались"));
});
test("source error is durable, no invented profile; resume recovers", async () => {
  reset();
  failSource = true;
  addLead("@failed");
  startJobs();
  await tick();
  assert.equal(row("SELECT status FROM agent_jobs").status, "failed");
  assert.equal(rows("SELECT * FROM profile_snapshots").length, 0);
  failSource = false;
  agentAction("resume");
  await tick();
  assert.equal(row("SELECT step FROM agent_jobs").step, 1);
});
test("pipeline generates 3 offers, independently selects and queues once", async () => {
  reset();
  control({ mode: "approval" });
  addLead("@pipeline");
  startJobs();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(rows("SELECT * FROM offers").length, 3);
  assert.equal(rows("SELECT * FROM offers WHERE selected=1").length, 1);
  assert.equal(row("SELECT status FROM agent_jobs").status, "completed");
  assert.equal(
    row("SELECT status FROM outreach_messages").status,
    "awaiting_approval",
  );
  assert.equal(startJobs(), 0);
  const original = row("SELECT id FROM outreach_messages").id;
  const alternative = row("SELECT id FROM offers WHERE selected=0 LIMIT 1").id;
  queueOffer(alternative);
  queueOffer(alternative);
  assert.equal(row("SELECT COUNT(*) n FROM outreach_messages").n, 1);
  assert.equal(row("SELECT id FROM outreach_messages").id, original);
  assert.equal(
    row("SELECT offer_id FROM outreach_messages").offer_id,
    alternative,
  );
  assert.equal(row("SELECT approved FROM outreach_messages").approved, 0);
});
test("unsupported recipient never sent, concurrent send is claimed once", async () => {
  reset();
  control({ mode: "automated" });
  addLead("@recipient");
  startJobs();
  for (let i = 0; i < 6; i++) await tick();
  const m = row("SELECT * FROM outreach_messages");
  control({ queuePaused: false });
  capability = false;
  await dispatch(m.id);
  assert.equal(sends, 0);
  assert.equal(
    row("SELECT status FROM outreach_messages").status,
    "manual_required",
  );
  capability = true;
  db.prepare("UPDATE outreach_messages SET status='queued'").run();
  await Promise.all([dispatch(m.id), dispatch(m.id)]);
  assert.equal(sends, 1);
  assert.equal(row("SELECT status FROM outreach_messages").status, "sent");
  await assert.rejects(() => dispatch(m.id));
  assert.throws(() => queueOffer(row("SELECT id FROM offers LIMIT 1").id));
});
test("pause, resume, stop and restart checkpoint without duplicated work", async () => {
  reset();
  addLead("@resume");
  startJobs();
  await tick();
  agentAction("pause");
  await tick();
  assert.equal(row("SELECT step FROM agent_jobs").step, 1);
  agentAction("resume");
  await tick();
  assert.equal(row("SELECT step FROM agent_jobs").step, 2);
  agentAction("stop");
  await tick();
  assert.equal(row("SELECT status FROM agent_jobs").status, "stopped");
  assert.equal(rows("SELECT * FROM offers").length, 0);
});
test("demo is labelled and cannot be sent", async () => {
  reset();
  demo();
  startJobs();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(row("SELECT demo FROM leads").demo, 1);
  const m = row("SELECT * FROM outreach_messages");
  assert.equal(m.status, "demo_draft");
  control({ queuePaused: false });
  await assert.rejects(() => dispatch(m.id));
  assert.equal(sends, 0);
});
test("blocked and opted out recipients are excluded", async () => {
  reset();
  const l = addLead("@blocked");
  db.prepare("UPDATE leads SET opted_out=1 WHERE id=?").run(l.id);
  assert.equal(startJobs(), 0);
});
test("credentials encrypted at rest, public settings omit values", () => {
  reset();
  saveSettings({ apiKey: "test-secret" });
  assert.ok(!row("SELECT data FROM ai_settings").data.includes("test-secret"));
  assert.equal(settings().apiKey, "test-secret");
  assert.equal((publicSettings() as any).apiKey, undefined);
});
test("data persists into a new process", () => {
  reset();
  addLead("@persistent");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      "const {db}=require('./lib/db.ts'); console.log(db.prepare('SELECT username FROM leads').get().username);db.close()",
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "persistent");
});
test("missing profile provider fails explicitly", async () => {
  reset();
  control({ profileUrl: "" });
  await assert.rejects(
    () => source.fetch("https://www.instagram.com/test/"),
    /Источник не подключён/,
  );
});

test("expired job lease recovers checkpoint without duplicate import", async () => {
  reset();
  addLead("@lease");
  startJobs();
  await tick();
  db.prepare("UPDATE agent_jobs SET status='running',lease_until=?").run(
    Date.now() - 1,
  );
  await tick();
  assert.equal(row("SELECT step FROM agent_jobs").step, 2);
  assert.equal(row("SELECT COUNT(*) n FROM profile_snapshots").n, 1);
});
test("ambiguous provider failure is not automatically retried", async () => {
  reset();
  control({ mode: "automated" });
  addLead("@unknown");
  startJobs();
  for (let i = 0; i < 6; i++) await tick();
  control({ queuePaused: false });
  failSend = true;
  const m = row("SELECT id FROM outreach_messages");
  await dispatch(m.id);
  assert.equal(
    row("SELECT status FROM outreach_messages").status,
    "delivery_unknown",
  );
  await tick();
  assert.equal(sends, 1);
  await assert.rejects(() => dispatch(m.id));
});
test("Responses-only endpoint fallback preserves image content", async () => {
  reset();
  responseOnly = true;
  const answer = await completion("Return JSON.", {}, "vision", [
    "https://example.com/image.jpg",
  ]);
  assert.equal(answer.ok, true);
  assert.equal(capturedResponseInput[0].content[1].type, "input_image");
  control({ apiStyle: "responses" });
  assert.equal((await completion("Return JSON.", {})).ok, true);
});
test("unavailable AI produces a recoverable error", async () => {
  reset();
  control({ baseUrl: "http://127.0.0.1:1/v1" });
  await assert.rejects(() => completion("Return JSON.", {}), /AI недоступен/);
});
