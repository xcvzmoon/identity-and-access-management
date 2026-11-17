import type { InferOutput } from 'valibot';
import { rateLimits } from '@iam/database/schema';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/valibot';

export const selectRateLimitSchema = createSelectSchema(rateLimits);
export const inputRateLimitSchema = createInsertSchema(rateLimits);
export const updateRateLimitSchema = createUpdateSchema(rateLimits);

export type SelectRateLimit = InferOutput<typeof selectRateLimitSchema>;
export type InsertRateLimit = InferOutput<typeof inputRateLimitSchema>;
export type UpdateRateLimit = InferOutput<typeof updateRateLimitSchema>;

export type RateLimit = SelectRateLimit;
