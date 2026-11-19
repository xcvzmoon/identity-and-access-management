import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { useDatabase } from '../database/index.ts';
import { authorizationTransactions, sessions } from '../database/schema.ts';

type Transaction = Omit<typeof authorizationTransactions.$inferSelect, 'cookieHash'>;
type Session = Omit<typeof sessions.$inferSelect, 'cookieHash'>;
type CallbackTransaction = Pick<Transaction, 'nonce' | 'returnTo' | 'verifier'>;
type SessionUser = Omit<Session, 'expiresAt'>;

const FIRST_RESULT = 0;

function hashCookie(cookie: string): string {
  return createHash('sha256').update(cookie).digest('hex');
}

function throwStorageError(): never {
  throw new Error('Console session storage operation failed.');
}

/**
 * Stores the browser's authorization transaction and removes abandoned, expired transactions.
 *
 * @param {string} cookie - Random browser transaction handle.
 * @param {Transaction} transaction - Callback checks and their expiry.
 */
export async function createTransaction(cookie: string, transaction: Transaction): Promise<void> {
  const database = useDatabase();
  const cookieHash = hashCookie(cookie);

  await database
    .transaction(async (connection) => {
      await connection
        .delete(authorizationTransactions)
        .where(lte(authorizationTransactions.expiresAt, sql`now()`));
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
 * Stores a validated identity until its token deadline and removes expired sessions.
 *
 * @param {string} cookie - Fresh random session handle.
 * @param {Session} session - Verified identity and its expiry.
 * @param {string} [previousCookie] - Browser session to replace in the same transaction.
 */
export async function createSession(
  cookie: string,
  session: Session,
  previousCookie?: string,
): Promise<void> {
  const database = useDatabase();
  const cookieHash = hashCookie(cookie);

  await database
    .transaction(async (connection) => {
      if (previousCookie) {
        await connection
          .delete(sessions)
          .where(eq(sessions.cookieHash, hashCookie(previousCookie)));
      }

      await connection.delete(sessions).where(lte(sessions.expiresAt, sql`now()`));
      await connection.insert(sessions).values({ ...session, cookieHash });
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
