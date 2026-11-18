import type { AuthOptions } from './auth.ts';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import * as valibot from 'valibot';

const codeLength = 8;
const codeLifetimeSeconds = 300;
const codeAttempts = 3;
const encoder = new TextEncoder();

export const accountCodeSchema = valibot.pipe(
  valibot.string('Enter the verification code.'),
  valibot.length(codeLength, 'Enter the eight-digit code.'),
  valibot.regex(/^[0-9]+$/u, 'Enter the eight-digit code.'),
);

export function accountCodes(options: AuthOptions): ReturnType<typeof emailOTP> {
  return emailOTP({
    disableSignUp: true,
    otpLength: codeLength,
    expiresIn: codeLifetimeSeconds,
    allowedAttempts: codeAttempts,
    storeOTP: {
      hash: async (otp) => {
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(options.secret),
          {
            name: 'HMAC',
            hash: 'SHA-256',
          },
          false,
          ['sign'],
        );
        const signature = await crypto.subtle.sign(
          'HMAC',
          key,
          encoder.encode(`iam-email-verification:${otp}`),
        );

        return Buffer.from(signature).toString('hex');
      },
    },
    sendVerificationOTP: () => {
      throw new APIError('FORBIDDEN');
    },
  });
}
