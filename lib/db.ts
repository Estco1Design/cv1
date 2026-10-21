import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const file = process.env.DATABASE_PATH || "./data/hideki.sqlite";
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL);
INSERT OR IGNORE INTO workspaces VALUES('default','HIDEKI');
CREATE TABLE IF NOT EXISTS instagram_accounts(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),provider TEXT,permissions TEXT);
CREATE TABLE IF NOT EXISTS lead_sources(id TEXT PRIMARY KEY,name TEXT,kind TEXT,config TEXT);
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,name TEXT,filters TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,demo INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'new',score REAL,confidence TEXT,blocked INTEGER NOT NULL DEFAULT 0,opted_out INTEGER NOT NULL DEFAULT 0,outcome TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile_snapshots(id TEXT PRIMARY KEY,lead_id TEXT REFERENCES leads(id),data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,snapshot_id TEXT REFERENCES profile_snapshots(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lead_assessments(id TEXT PRIMARY KEY,lead_id TEXT REFERENCES leads(id),data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offers(id TEXT PRIMARY KEY,lead_id TEXT REFERENCES leads(id),variant TEXT NOT NULL,body TEXT NOT NULL,evaluation TEXT NOT NULL,selected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outreach_messages(id TEXT PRIMARY KEY,lead_id TEXT UNIQUE REFERENCES leads(id),offer_id TEXT REFERENCES offers(id),body TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,provider_id TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,lead_id TEXT REFERENCES leads(id),body TEXT NOT NULL,direction TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,lead_id TEXT,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_jobs(id TEXT PRIMARY KEY,lead_id TEXT REFERENCES leads(id),status TEXT NOT NULL,step INTEGER NOT NULL DEFAULT 0,steps TEXT NOT NULL DEFAULT '{}',error TEXT,lease_until INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_job ON agent_jobs(lead_id) WHERE status IN ('queued','running','paused');
CREATE TABLE IF NOT EXISTS ai_settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
`);
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function activity(lead: string | null, event: string, detail: string) {
  const args = [id(), lead, event, detail, now()];
  db.prepare("INSERT INTO activities VALUES(?,?,?,?,?)").run(...args);
  db.prepare("INSERT INTO audit_logs VALUES(?,?,?,?)").run(
    id(),
    event,
    detail,
    now(),
  );
}
export function rows(sql: string, ...args: unknown[]): any[] {
  return db.prepare(sql).all(...args);
}
export function row(sql: string, ...args: unknown[]): any {
  return db.prepare(sql).get(...args);
}
export function insert(table: string, data: Record<string, unknown>) {
  const keys = Object.keys(data);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...Object.values(data));
}
