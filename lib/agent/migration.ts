import { db } from "../db";
db.exec(`
CREATE TABLE IF NOT EXISTS agent_tasks(id TEXT PRIMARY KEY,prompt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',phase TEXT NOT NULL DEFAULT 'parse',intent TEXT,cursor TEXT,source_handle TEXT,source_kind TEXT NOT NULL,exhausted INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,error TEXT,summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_chat_messages(id TEXT PRIMARY KEY,task_id TEXT REFERENCES agent_tasks(id),role TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_steps(id TEXT PRIMARY KEY,task_id TEXT REFERENCES agent_tasks(id),candidate_id TEXT,tool TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE TABLE IF NOT EXISTS agent_candidates(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES agent_tasks(id),handle TEXT NOT NULL,source_handle TEXT NOT NULL,source_cursor TEXT,lead_id TEXT REFERENCES leads(id),stage TEXT NOT NULL DEFAULT 'profile',profile TEXT,posts TEXT,assessment TEXT,generated TEXT,selection TEXT,location_evidence TEXT,score REAL,message_id TEXT REFERENCES outreach_messages(id),rejection TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(task_id,handle));
CREATE INDEX IF NOT EXISTS task_candidates ON agent_candidates(task_id,stage);
CREATE INDEX IF NOT EXISTS task_steps ON agent_steps(task_id,started_at);
INSERT OR IGNORE INTO schema_migrations VALUES(2,datetime('now'));
`);
