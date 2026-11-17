import { defineRelations } from 'drizzle-orm';
import * as schema from './schema/index.ts';

/** RC relation registry populated from the package's table exports. */
export const relations = defineRelations(schema);
