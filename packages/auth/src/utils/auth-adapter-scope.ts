import type { Auth } from './auth.ts';
import { runWithAdapter } from '@better-auth/core/context';

/**
 * Runs Better Auth calls with the adapter from the supplied auth instance.
 * @param {Auth} auth - The instance bound to the caller's database or transaction.
 * @param {() => Promise<Result>} work - The operation that uses the scoped adapter.
 * @returns {Promise<Result>} The result of the operation.
 */
export async function withAuthAdapter<Result>(
  auth: Auth,
  work: () => Promise<Result>,
): Promise<Result> {
  const { adapter } = await auth.$context;
  return runWithAdapter(adapter, work);
}
