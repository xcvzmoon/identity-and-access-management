import { type SQL, and, eq, gt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { useDatabase } from '../database/index.ts';
import { authorizationTransactions, sessions } from '../database/schema.ts';

type Transaction = Omit<typeof authorizationTransactions.$inferSelect, 'cookieHash'>;
type Session = Omit<typeof sessions.$inferSelect, 'cookieHash' | 'encryptedAccessToken'>;
type CallbackTransaction = Pick<Transaction, 'nonce' | 'returnTo' | 'verifier'>;
type SessionUser = Omit<Session, 'expiresAt'>;

const EXPIRY_CLEANUP_BATCH = 100;
const FIRST_RESULT = 0;
const IV_START = 0;
const IV_BYTES = 12;

async function getTokenKey(cookie: string): Promise<CryptoKey> {
  const digest = createHash('sha256').update('console-access-token:').update(cookie).digest();
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function hashCookie(cookie: string): string {
  return createHash('sha256').update(cookie).digest('hex');
}

function throwStorageError(): never {
  throw new Error('Console session storage operation failed.');
}

function deleteExpiredBatch(table: typeof authorizationTransactions | typeof sessions): SQL {
  return sql`
    WITH expired AS MATERIALIZED (
      SELECT ${table.cookieHash} FROM ${table}
      WHERE ${table.expiresAt} <= now()
      ORDER BY ${table.expiresAt}
      LIMIT ${EXPIRY_CLEANUP_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM ${table}
    USING expired
    WHERE ${table.cookieHash} = expired.cookie_hash
  `;
}

/**
 * Stores the browser's authorization transaction and removes up to 100 unlocked expired transactions.
 *
 * @param {string} cookie - Random browser transaction handle.
 * @param {Transaction} transaction - Callback checks and their expiry.
 */
export async function createTransaction(cookie: string, transaction: Transaction): Promise<void> {
  const database = useDatabase();
  const cookieHash = hashCookie(cookie);

  await database
    .transaction(async (connection) => {
      await connection.execute(deleteExpiredBatch(authorizationTransactions));
      await connection.insert(authorizationTransactions).values({ ...transaction, cookieHash });
    })
    .catch(throwStorageError);
}

/**
 * Consumes a matching, unexpired transaction once across concurrent callback requests.
 *
 * @param {string} cookie - Handle from the browser cookie.
 * @param {string} state - State returned by the issuer.
 * @returns {Promise<CallbackTransaction | null>} The saved callback checks, or null if no eligible transaction matched.
 */
export async function consumeTransaction(
  cookie: string,
  state: string,
): Promise<CallbackTransaction | null> {
  const database = useDatabase();
  const transactions = await database
    .delete(authorizationTransactions)
    .where(
      and(
        eq(authorizationTransactions.cookieHash, hashCookie(cookie)),
        eq(authorizationTransactions.state, state),
        gt(authorizationTransactions.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({
      nonce: authorizationTransactions.nonce,
      returnTo: authorizationTransactions.returnTo,
      verifier: authorizationTransactions.verifier,
    })
    .catch(throwStorageError);

  return transactions.at(FIRST_RESULT) ?? null;
}

/**
 * Stores a validated identity until its token deadline and removes up to 100 unlocked expired sessions.
 *
 * @param {string} cookie - Fresh random session handle.
 * @param {Session} session - Verified identity and its expiry.
 * @param {string} accessToken - Console access token used for management requests.
 * @param {string} [previousCookie] - Browser session to replace in the same transaction.
 */
export async function createSession(
  cookie: string,
  session: Session,
  accessToken: string,
  previousCookie?: string,
): Promise<void> {
  const database = useDatabase();
  const cookieHash = hashCookie(cookie);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await getTokenKey(cookie);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    new TextEncoder().encode(accessToken),
  );
  const encryptedAccessToken = Buffer.concat([iv, new Uint8Array(encrypted)]).toString('base64');

  await database
    .transaction(async (connection) => {
      if (previousCookie) {
        await connection
          .delete(sessions)
          .where(eq(sessions.cookieHash, hashCookie(previousCookie)));
      }

      await connection.execute(deleteExpiredBatch(sessions));
      await connection.insert(sessions).values({ ...session, cookieHash, encryptedAccessToken });
    })
    .catch(throwStorageError);
}

/**
 * Returns the identity bound to an unexpired console cookie, or null when absent.
 *
 * @param {string} cookie - Handle from the browser cookie.
 * @returns {Promise<SessionUser | null>} The session identity or null after expiry or sign-out.
 */
export async function readSession(cookie: string): Promise<SessionUser | null> {
  const database = useDatabase();
  const users = await database
    .select({
      sub: sessions.sub,
      email: sessions.email,
      name: sessions.name,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.cookieHash, hashCookie(cookie)),
        gt(sessions.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .catch(throwStorageError);

  return users.at(FIRST_RESULT) ?? null;
}

/**
 * Revokes the console session identified by this cookie. Repeated sign-out is safe.
 *
 * @param {string} cookie - Handle from the browser cookie.
 */
export async function deleteSession(cookie: string): Promise<void> {
  const database = useDatabase();
  await database
    .delete(sessions)
    .where(eq(sessions.cookieHash, hashCookie(cookie)))
    .catch(throwStorageError);
}

/**
 * Opens the access token for an unexpired console session.
 * @param {string} cookie - Browser handle required to decrypt the stored token.
 * @returns {Promise<string | null>} Null for expired sessions and sessions created before token storage.
 */
export async function readAccessToken(cookie: string): Promise<string | null> {
  const database = useDatabase();
  const records = await database
    .select({ token: sessions.encryptedAccessToken })
    .from(sessions)
    .where(
      and(
        eq(sessions.cookieHash, hashCookie(cookie)),
        gt(sessions.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .catch(throwStorageError);
  const token = records.at(FIRST_RESULT)?.token;

  if (!token) {
    return null;
  }

  const bytes = Buffer.from(token, 'base64');
  const key = await getTokenKey(cookie);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes.subarray(IV_START, IV_BYTES),
    },
    key,
    bytes.subarray(IV_BYTES),
  );

  return new TextDecoder().decode(decrypted);
}
