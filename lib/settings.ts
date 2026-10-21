import crypto from "node:crypto";
import { db, row } from "./db";
export const defaults = {
  provider: "FreeLLMAPI",
  baseUrl: process.env.AI_BASE_URL || "http://127.0.0.1:31415/v1",
  model: process.env.AI_MODEL || "auto:coding",
  analysisModel: "",
  generationModel: "",
  evaluationModel: "",
  visionModel: "",
  temperature: 0.4,
  maxTokens: 3000,
  apiStyle: "auto",
  apiKey: "",
  profileKey: "",
  outreachKey: "",
  profileUrl: process.env.PROFILE_PROVIDER_URL || "",
  outreachUrl: process.env.OUTREACH_PROVIDER_URL || "",
  mode: "draft",
  queuePaused: true,
  minIntervalSeconds: 120,
  threshold: 50,
  weights: [25, 25, 20, 15, 15],
  knowledge: {
    biography: "Александр Хидеки — fashion-фотограф.",
    portfolio: "",
    strengths: "",
    shootTypes: "Fashion, коммерческие съёмки",
    audience: "Fashion-бренды, дизайнеры, стилисты",
    terms: "Обсуждаются индивидуально",
    examples: "",
    forbidden: "Уникальное предложение; гарантированный результат",
  },
  agent: "stopped",
  lastDispatch: 0,
  workerHeartbeat: 0,
};
export type Settings = typeof defaults;
const secrets = ["apiKey", "profileKey", "outreachKey"] as const;
function key() {
  const value = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(
      "Для сохранения ключей задайте SETTINGS_ENCRYPTION_KEY (64 hex символа)",
    );
  return Buffer.from(value, "hex");
}
function seal(value: string) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}
function open(value: string) {
  if (!value.startsWith("enc:")) return value;
  const b = Buffer.from(value.slice(4), "base64"),
    d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
export function settings(): Settings {
  const saved = row("SELECT data FROM ai_settings WHERE id=?", "default");
  const s = { ...defaults, ...(saved ? JSON.parse(saved.data) : {}) };
  for (const k of secrets) s[k] = open(s[k] || "");
  s.apiKey ||= process.env.AI_API_KEY || "";
  s.profileKey ||= process.env.PROFILE_PROVIDER_KEY || "";
  s.outreachKey ||= process.env.OUTREACH_PROVIDER_KEY || "";
  return s;
}
export function publicSettings() {
  const s: any = settings();
  for (const k of secrets) {
    s[k + "Configured"] = !!s[k];
    delete s[k];
  }
  return s;
}
export function saveSettings(patch: Partial<Settings>) {
  db.transaction(() => {
    const s = settings();
    const safe: any = {};
    for (const k of Object.keys(defaults))
      if (k in patch) safe[k] = (patch as any)[k];
    for (const k of secrets) if (!safe[k]) delete safe[k];
    const merged = { ...s, ...safe };
    for (const k of secrets) if (merged[k]) merged[k] = seal(merged[k]);
    db.prepare(
      "INSERT INTO ai_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run("default", JSON.stringify(merged));
  }).immediate();
}
// Internal control updates do not re-encrypt environment-injected keys.
export function control(patch: Partial<Settings>) {
  // One atomic JSON merge: web control updates and worker heartbeats must not overwrite each other.
  db.prepare(
    "INSERT INTO ai_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=json_patch(ai_settings.data,excluded.data)",
  ).run("default", JSON.stringify(patch));
}
