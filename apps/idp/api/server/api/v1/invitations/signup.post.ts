import { defineHandler } from 'nitro';
import { readBody } from 'nitro/h3';
import * as valibot from 'valibot';
import { signupSchema } from '../../../schemas/invitation.ts';
import { authHeaders, checkAuthPost, privateResponse } from '../../../services/auth.service.ts';
import { signUpWithInvitation } from '../../../services/invitation.service.ts';
import { BadRequestError } from '../../../utils/http-errors.ts';

export default defineHandler(async (event): Promise<Response> => {
  checkAuthPost(event);

  const body = await readBody<unknown>(event);
  const result = valibot.safeParse(signupSchema, body);

  if (!result.success) {
    throw new BadRequestError('Invalid invitation signup details.');
  }

  const headers = authHeaders(event);
  const response = await signUpWithInvitation(result.output, headers);

  if (!response.ok) {
    return privateResponse(response);
  }

  return privateResponse(Response.json({ status: true }));
});
