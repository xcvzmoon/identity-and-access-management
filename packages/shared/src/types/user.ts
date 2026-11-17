import type { InferOutput } from 'valibot';
import { users } from '@iam/database/schema';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const selectUserSchema = createSelectSchema(users);
export const inputUserSchema = createInsertSchema(users);
export const updateUserSchema = createUpdateSchema(users);

export type SelectUser = InferOutput<typeof selectUserSchema>;
export type InsertUser = InferOutput<typeof inputUserSchema>;
export type UpdateUser = InferOutput<typeof updateUserSchema>;

export type User = SelectUser;
