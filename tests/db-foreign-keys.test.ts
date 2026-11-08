import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated throwaway DB, never the real data/scout.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-fk-test-'));
process.env.SCOUT_DB_PATH = path.join(tmpDir, 'scout.db');

const { getDb } = await import('@/db/client');
const { createAccount } = await import('@/data/accounts');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('db client foreign keys', () => {
  it('still cascades deletes after earlier writes were saved to disk', () => {
    // sql.js export() (run on every save) resets PRAGMA foreign_keys to OFF.
    const db = getDb();
    const account = createAccount({ name: 'Cascade Test Co' });
    db.prepare('INSERT INTO crm_notes (id, account_id, content, created_at) VALUES (?, ?, ?, ?)').run('n1', account.id, 'note', new Date().toISOString());
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM crm_notes WHERE account_id = ?').get(account.id)).toEqual({ n: 0 });
  });
});
