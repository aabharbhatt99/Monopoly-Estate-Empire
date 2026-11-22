import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'estate-empire.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    host_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const upsert = db.prepare(`
  INSERT INTO rooms (code, mode, status, host_id, summary, data, created_at, updated_at)
  VALUES (@code, @mode, @status, @host_id, @summary, @data, @created_at, @updated_at)
  ON CONFLICT(code) DO UPDATE SET
    mode = excluded.mode, status = excluded.status, host_id = excluded.host_id,
    summary = excluded.summary, data = excluded.data, updated_at = excluded.updated_at
`);
const selectOne = db.prepare('SELECT data FROM rooms WHERE code = ?');
const selectAll = db.prepare('SELECT code, mode, status, summary, created_at, updated_at FROM rooms ORDER BY updated_at DESC LIMIT 200');
const deleteOne = db.prepare('DELETE FROM rooms WHERE code = ?');

export interface StoredRoomRow {
  code: string;
  mode: string;
  status: string;
  summary: any;
  createdAt: number;
  updatedAt: number;
}

export const store = {
  save(row: { code: string; mode: string; status: string; hostId: string; summary: object; data: object; createdAt: number; updatedAt: number }) {
    upsert.run({
      code: row.code,
      mode: row.mode,
      status: row.status,
      host_id: row.hostId,
      summary: JSON.stringify(row.summary),
      data: JSON.stringify(row.data),
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    });
  },
  load(code: string): any | null {
    const r = selectOne.get(code) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : null;
  },
  list(): StoredRoomRow[] {
    return (selectAll.all() as any[]).map((r) => ({
      code: r.code,
      mode: r.mode,
      status: r.status,
      summary: JSON.parse(r.summary),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },
  remove(code: string) {
    deleteOne.run(code);
  },
};
