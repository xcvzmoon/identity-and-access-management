import type { InferOutput } from 'valibot';
import { sessions } from '@iam/database/schema';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const selectSessionSchema = createSelectSchema(sessions);
export const inputSessionSchema = createInsertSchema(sessions);
export const updateSessionSchema = createUpdateSchema(sessions);

export type SelectSession = InferOutput<typeof selectSessionSchema>;
export type InsertSession = InferOutput<typeof inputSessionSchema>;
export type UpdateSession = InferOutput<typeof updateSessionSchema>;

export type Session = SelectSession;
