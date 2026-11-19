import { sql } from 'drizzle-orm';
import { useDatabase } from '../database/index.ts';

export async function checkDbConnection(): Promise<void> {
  await useDatabase().execute(sql`select 1`);
}
