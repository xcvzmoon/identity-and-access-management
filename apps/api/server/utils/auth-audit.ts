import { useAuth } from '@iam/auth';
import { randomUUID } from 'node:crypto';
import * as valibot from 'valibot';

const tooManyRequests = 429;
const unauthorized = 401;
const forbidden = 403;
const firstClientError = 400;
const firstServerError = 500;
const signedInUserSchema = valibot.object({
  user: valibot.object({ id: valibot.pipe(valibot.string(), valibot.uuid()) }),
});
const recoveryResultSchema = valibot.union([
  valibot.object({ accepted: valibot.literal(true) }),
  valibot.object({ reset: valibot.literal(true) }),
]);
const verificationRequiredSchema = valibot.object({
  code: valibot.literal('EMAIL_NOT_VERIFIED'),
});

type EventName = 'AUTH_EMAIL_SIGN_IN' | 'AUTH_PASSWORD_RECOVERY';
type Outcome = 'accepted' | 'succeeded' | 'denied' | 'throttled' | 'error';
type Result = {
  outcome: Outcome;
  userId: string | null;
};

async function readSuccess(event: EventName, response: Response): Promise<Result> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);

  if (event === 'AUTH_EMAIL_SIGN_IN') {
    const user = valibot.safeParse(signedInUserSchema, body);
    return {
      outcome: user.success ? 'succeeded' : 'error',
      userId: user.success ? user.output.user.id : null,
    };
  }

  const recovery = valibot.safeParse(recoveryResultSchema, body);
  let outcome: Outcome = 'error';

  if (recovery.success) {
    outcome = 'accepted' in recovery.output ? 'accepted' : 'succeeded';
  }

  return {
    outcome,
    userId: null,
  };
}

function failureOutcome(status: number): Outcome {
  if (status === tooManyRequests) {
    return 'throttled';
  }

  if (status >= firstClientError && status < firstServerError) {
    return 'denied';
  }

  return 'error';
}

async function normalizeSignInFailure(response: Response): Promise<Response> {
  if (response.status === forbidden) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);

    if (!valibot.safeParse(verificationRequiredSchema, body).success) {
      return response;
    }
  } else if (response.status !== unauthorized) {
    return response;
  }

  await response.body?.cancel();
  return Response.json(
    {
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    },
    {
      status: unauthorized,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

function writeAuditEvent(
  event: EventName,
  requestId: string,
  status: number,
  result: Result,
): void {
  console.info(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      requestId,
      status,
      ...result,
    }),
  );
}

/**
 * Records an authentication result and adds its audit ID to the response.
 * @param {Request} request - The inbound authentication request.
 * @param {EventName} event - The audit event for this route.
 * @returns {Promise<Response>} The sign-in response with its body and cookies intact.
 * @throws {Error} If Better Auth throws while handling the request.
 */
export async function auditAuthRequest(request: Request, event: EventName): Promise<Response> {
  const requestId = randomUUID();

  try {
    const upstream = await useAuth().handler(request);

    const response =
      event === 'AUTH_EMAIL_SIGN_IN' ? await normalizeSignInFailure(upstream) : upstream;

    const result = response.ok
      ? await readSuccess(event, response)
      : {
          outcome: failureOutcome(response.status),
          userId: null,
        };

    const correlatedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    correlatedResponse.headers.set('X-Request-ID', requestId);

    writeAuditEvent(event, requestId, response.status, result);

    return correlatedResponse;
  } catch (error) {
    writeAuditEvent(event, requestId, firstServerError, {
      outcome: 'error',
      userId: null,
    });

    throw error;
  }
}
