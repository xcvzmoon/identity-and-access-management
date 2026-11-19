import * as valibot from 'valibot';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../utils/auth.ts';

export type InvitationSignup = valibot.InferOutput<typeof signupSchema>;

const tokenSchema = valibot.pipe(valibot.string(), valibot.uuid());

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 128;

export const signupSchema = valibot.object({
  token: tokenSchema,
  email: valibot.pipe(
    valibot.string(),
    valibot.trim(),
    valibot.email(),
    valibot.maxLength(MAX_EMAIL_LENGTH),
  ),
  name: valibot.pipe(
    valibot.string(),
    valibot.trim(),
    valibot.nonEmpty(),
    valibot.maxLength(MAX_NAME_LENGTH),
  ),
  password: valibot.pipe(
    valibot.string(),
    valibot.minLength(MIN_PASSWORD_LENGTH),
    valibot.maxLength(MAX_PASSWORD_LENGTH),
  ),
});
export const acceptanceSchema = valibot.object({ token: tokenSchema });
