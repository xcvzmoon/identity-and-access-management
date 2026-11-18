import { sql } from 'drizzle-orm';

export const issuerSigningAlgorithm = 'RS256';
export const signingKeyGraceSeconds = 2_592_000;
export const lockSigningKeys = sql`select pg_advisory_xact_lock(hashtext('iam.jwks'), 0)`;
