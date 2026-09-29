import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

import type { AflTradeExternalCaptureAdmissionRedis } from '../source/externalDraftTradeCaptureAdmission';

const stateSchema = z
  .object({
    schemaVersion: z.literal('statly-local-capture-admission/v1'),
    providerKey: z.string().min(1),
    lease: z.object({ token: z.string().min(1), expiresAtMs: z.number().int() }).nullable(),
    providerUntilMs: z.number().int().nonnegative(),
    requests: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

type AdmissionState = z.infer<typeof stateSchema>;

const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Local, single-host stand-in for the Redis admission scripts. It keeps the same lease, provider
 * cooldown and request cooldown semantics in one JSON file per provider under an operator-chosen
 * directory, so separate local runs share one provider pacing. A leftover lock fails closed; it is
 * never broken automatically because that could admit two concurrent fetches.
 */
export function createLocalFileCaptureAdmissionStore(options: {
  directory: string;
}): AflTradeExternalCaptureAdmissionRedis {
  if (!isAbsolute(options.directory)) {
    throw new TypeError('Local capture admission requires one absolute state directory.');
  }
  const directory = resolve(options.directory);

  function pathsFor(providerKey: string) {
    const name = createHash('sha256').update(providerKey, 'utf8').digest('hex');
    return {
      state: join(directory, `${name}.json`),
      lock: join(directory, `${name}.lock`),
      pending: join(directory, `${name}.pending`),
    };
  }

  async function withLock<T>(providerKey: string, action: (state: AdmissionState) => Promise<T>) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new TypeError('Local capture admission requires one real state directory.');
    }
    const paths = pathsFor(providerKey);
    const deadline = Date.now() + LOCK_WAIT_MS;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    while (handle === null) {
      try {
        handle = await open(paths.lock, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) {
          throw new Error(
            `Local capture admission is locked by another run (${paths.lock}). Remove the lock only after confirming no capture run is active.`
          );
        }
        await sleep(LOCK_POLL_MS);
      }
    }
    try {
      let state: AdmissionState;
      try {
        state = stateSchema.parse(JSON.parse(await readFile(paths.state, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error('Local capture admission state is unreadable; capture is blocked.', {
            cause: error,
          });
        }
        state = {
          schemaVersion: 'statly-local-capture-admission/v1',
          providerKey,
          lease: null,
          providerUntilMs: 0,
          requests: {},
        };
      }
      if (state.providerKey !== providerKey) {
        throw new Error('Local capture admission state belongs to a different provider key.');
      }
      const result = await action(state);
      const pending = await open(paths.pending, 'w', 0o600);
      try {
        await pending.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
        await pending.sync();
      } finally {
        await pending.close();
      }
      await rename(paths.pending, paths.state);
      return result;
    } finally {
      await handle.close();
      await rm(paths.lock, { force: true });
    }
  }

  return {
    acquire: (input) =>
      withLock(input.providerKey, async (state) => {
        for (const [key, untilMs] of Object.entries(state.requests)) {
          if (untilMs <= input.nowMs) delete state.requests[key];
        }
        if (state.lease !== null && state.lease.expiresAtMs > input.nowMs) {
          return { acquired: false as const, retryAtMs: state.lease.expiresAtMs };
        }
        state.lease = null;
        const retryAtMs = Math.max(state.providerUntilMs, state.requests[input.requestKey] ?? 0);
        if (retryAtMs > input.nowMs) return { acquired: false as const, retryAtMs };
        const expiresAtMs = input.nowMs + input.leaseMs;
        state.lease = { token: input.token, expiresAtMs };
        return { acquired: true as const, expiresAtMs };
      }),
    complete: (input) =>
      withLock(input.providerKey, async (state) => {
        // Mirrors Redis key expiry: an expired or replaced lease is lost, not silently renewed.
        if (
          state.lease === null ||
          state.lease.token !== input.token ||
          state.lease.expiresAtMs < input.completedAtMs
        ) {
          return false;
        }
        state.lease = null;
        state.providerUntilMs = input.completedAtMs + input.providerCooldownMs;
        state.requests[input.requestKey] = input.completedAtMs + input.requestCooldownMs;
        return true;
      }),
  };
}
