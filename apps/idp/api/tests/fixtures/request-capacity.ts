export type RequestSample = {
  requests: number;
  concurrency: number;
  successful: number;
  failed: number;
  elapsedMs: number;
  successfulPerSecond: number;
  p95Ms: number | null;
  p99Ms: number | null;
};

const FIRST_RANK = 1;
const MILLISECONDS_PER_SECOND = 1000;
const P95 = 0.95;
const P99 = 0.99;

function percentile(sorted: readonly number[], fraction: number): number | null {
  return sorted.at(Math.ceil(sorted.length * fraction) - FIRST_RANK) ?? null;
}

/**
 * Runs a closed-loop request sample and summarizes successful request durations.
 * @param {number} requests - Total number of attempts shared by all workers.
 * @param {number} concurrency - Maximum number of requests in flight.
 * @param {Function} timeRequest - Returns elapsed milliseconds for a valid response or null for a failed attempt.
 * @returns {Promise<RequestSample>} Attempt counts, successful throughput and nearest-rank latency percentiles.
 */
export async function measureRequests(
  requests: number,
  concurrency: number,
  timeRequest: () => Promise<number | null>,
): Promise<RequestSample> {
  const durations: number[] = [];
  const pending = Array.from({ length: requests }).keys();

  async function runWorker(): Promise<void> {
    while (!pending.next().done) {
      // Each worker waits for its response to keep the requested concurrency.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const duration = await timeRequest();
      if (duration !== null) {
        durations.push(duration);
      }
    }
  }

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, runWorker));
  const elapsedMs = performance.now() - started;
  durations.sort((left, right) => left - right);

  return {
    requests,
    concurrency,
    successful: durations.length,
    failed: requests - durations.length,
    elapsedMs,
    successfulPerSecond: (durations.length * MILLISECONDS_PER_SECOND) / elapsedMs,
    p95Ms: percentile(durations, P95),
    p99Ms: percentile(durations, P99),
  };
}
