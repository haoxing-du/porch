import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
export type DB = pg.Pool | pg.PoolClient;
export function pool(connectionString: string, schema?: string) { return new pg.Pool({connectionString, max: 12, ...(schema ? {options:`-c search_path=${schema}`} : {})}); }
export async function tx<T>(db: pg.Pool, fn: (client: pg.PoolClient)=>Promise<T>): Promise<T> {
  const client = await db.connect();
  try {await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result;}
  catch (error) {await client.query('ROLLBACK'); throw error;}
  finally {client.release();}
}
export async function migrate(db: pg.Pool) {
  await tx(db, async c => {
    await c.query('SELECT pg_advisory_xact_lock(791643200)');
    await c.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(folder)).filter(n=>n.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM migrations WHERE name=$1',[name])).rowCount) continue;
      await c.query(await readFile(new URL(name,folder),'utf8'));
      await c.query('INSERT INTO migrations(name) VALUES($1)',[name]);
    }
  });
}
