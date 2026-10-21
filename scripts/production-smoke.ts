import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "hideki-smoke-"));
const password = "Тест-" + randomBytes(24).toString("hex");
const env = {
  ...process.env,
  DATABASE_PATH: join(dir, "smoke.sqlite"),
  APP_PASSWORD: password,
  SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  INSTAGRAM_SESSION_DIR: join(dir, "no-browser-login"),
  AI_BASE_URL: "http://127.0.0.1:1/v1",
  AI_API_KEY: "",
  PROFILE_PROVIDER_URL: "",
  PROFILE_PROVIDER_KEY: "",
  OUTREACH_PROVIDER_URL: "",
  OUTREACH_PROVIDER_KEY: "",
};
const base = "http://127.0.0.1:31811";
const authorization =
  "Basic " + Buffer.from("hideki:" + password).toString("base64");
let server: ChildProcess | undefined, worker: ChildProcess | undefined;
const pause = () => new Promise((r) => setTimeout(r, 500));
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
async function ready(headers: Record<string, string> = {}) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(base + "/api/state", { headers });
      if (r.status !== 500) return r;
    } catch {}
    await pause();
  }
  throw new Error("Server did not start");
}
async function api(path: string, body?: unknown) {
  const r = await fetch(base + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, 200, data.error);
  return data;
}
async function main() {
  try {
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "31811",
      ],
      { env: { ...env, APP_PASSWORD: "" }, stdio: "ignore" },
    );
    assert.equal((await ready()).status, 503);
    await stop(server);
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "31811",
      ],
      { env, stdio: "ignore" },
    );
    assert.equal((await ready()).status, 401);
    assert.equal((await ready({ authorization })).status, 200);
    const foreign = await fetch(base + "/api/import", {
      method: "POST",
      headers: {
        authorization,
        origin: "https://invalid.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "@not_imported" }),
    });
    assert.equal(foreign.status, 400);
    await api("import", { url: "@production_smoke" });
    const demo = await api("demo", {});
    await api("agent", { action: "start", leadId: demo.id });
    worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts"], {
      env,
      stdio: "ignore",
    });
    let completed = false;
    for (let i = 0; i < 70; i++) {
      const state = await api("state");
      if (state.jobs.some((j: any) => j.status === "completed")) {
        assert.equal(state.stats.offers, 3);
        assert.equal(state.messages[0].status, "demo_draft");
        completed = true;
        break;
      }
      await pause();
    }
    assert.ok(completed, "Worker did not finish demo pipeline");
    const task = await api("agent/tasks", {
      prompt: "Изучи подписчиков @alexandro_hideki, найди 1 клиента из Москвы",
      source: "browser",
    });
    let blocked = false;
    for (let i = 0; i < 50; i++) {
      const detail = await api("agent/tasks/" + task.id);
      if (detail.status === "blocked") {
        assert.ok(detail.error.includes("сессия не подключена"));
        assert.ok(
          detail.steps.some(
            (s: any) => s.tool === "getFollowers" && s.status === "failed",
          ),
        );
        blocked = true;
        break;
      }
      await pause();
    }
    assert.ok(
      blocked,
      "V2 must expose missing real browser session, never fake followers",
    );
    await stop(worker);
    await stop(server);
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "31811",
      ],
      { env, stdio: "ignore" },
    );
    await ready({ authorization });
    const restored = await api("state");
    assert.equal(restored.stats.total, 2);
    assert.equal(restored.messages.length, 1);
    const restoredTask = await api("agent/tasks/" + task.id);
    assert.equal(restoredTask.status, "blocked");
    assert.equal(restoredTask.source_handle, "alexandro_hideki");
    await api("agent/tasks/" + task.id + "/control", { action: "resume" });
    worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts"], {
      env,
      stdio: "ignore",
    });
    let recovered = false;
    for (let i = 0; i < 40; i++) {
      const detail = await api("agent/tasks/" + task.id);
      if (detail.status === "blocked") {
        assert.equal(
          detail.steps.filter(
            (s: any) => s.tool === "parseTask" && s.status === "completed",
          ).length,
          1,
        );
        recovered = true;
        break;
      }
      await pause();
    }
    assert.ok(
      recovered,
      "V2 resumed worker must reuse parsed intent after restart",
    );

    const ai = await fetch(base + "/api/ai-test", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(ai.status, 400);
    assert.match((await ai.json()).error, /AI недоступен/);
    console.log(
      "Production smoke PASS: fail-closed auth, UTF-8 credentials, CSRF, import, actual V1/V2 workers, persistent task restart/resume, honest missing-session block, unavailable AI handled. No external messages sent.",
    );
  } finally {
    await stop(worker);
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
