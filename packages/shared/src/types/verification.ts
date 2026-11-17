import type { InferOutput } from 'valibot';
import { verifications } from '@iam/database/schema';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const selectVerificationSchema = createSelectSchema(verifications);
export const inputVerificationSchema = createInsertSchema(verifications);
export const updateVerificationSchema = createUpdateSchema(verifications);

export type SelectVerification = InferOutput<typeof selectVerificationSchema>;
export type InsertVerification = InferOutput<typeof inputVerificationSchema>;
export type UpdateVerification = InferOutput<typeof updateVerificationSchema>;

export type Verification = SelectVerification;
