import { sql } from 'drizzle-orm';
import { useDatabase } from '../database/index.ts';

export async function checkDbConnection(): Promise<void> {
  const database = useDatabase();
  await database.execute(sql`select 1`);
}
