import type { InferOutput } from 'valibot';
import { accounts } from '@iam/database/schema';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const selectAccountSchema = createSelectSchema(accounts);
export const inputAccountSchema = createInsertSchema(accounts);
export const updateAccountSchema = createUpdateSchema(accounts);

export type SelectAccount = InferOutput<typeof selectAccountSchema>;
export type InsertAccount = InferOutput<typeof inputAccountSchema>;
export type UpdateAccount = InferOutput<typeof updateAccountSchema>;

export type Account = SelectAccount;
