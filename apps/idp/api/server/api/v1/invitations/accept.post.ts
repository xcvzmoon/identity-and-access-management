import { defineHandler } from 'nitro';
import { readBody } from 'nitro/h3';
import * as valibot from 'valibot';
import { acceptanceSchema } from '../../../schemas/invitation.ts';
import { authHeaders, checkAuthPost, privateResponse } from '../../../services/auth.service.ts';
import { acceptInvitation } from '../../../services/invitation.service.ts';
import { BadRequestError } from '../../../utils/http-errors.ts';

export default defineHandler(async (event): Promise<Response> => {
  checkAuthPost(event);

  const headers = authHeaders(event);
  const body = await readBody<unknown>(event);
  const result = valibot.safeParse(acceptanceSchema, body);

  if (!result.success) {
    throw new BadRequestError('This invitation is unavailable.');
  }

  await acceptInvitation(result.output.token, headers);
  return privateResponse(Response.json({ status: true }));
});
