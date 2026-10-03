import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalFileCaptureAdmissionStore } from '@/server/aflTradeIntelligence/development/localFileCaptureAdmissionStore';
import { createAflTradeExternalCaptureAdmission } from '@/server/aflTradeIntelligence/source/externalDraftTradeCaptureAdmission';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function stateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'statly-local-admission-'));
  directories.push(directory);
  return join(directory, 'capture-admission');
}

const policy = {
  upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
  cacheSeconds: 86_400,
  maximumLeaseMs: 120_000,
  egressPolicyEvidenceId: `artifact:${'2'.repeat(64)}`,
};

function admissionFor(directory: string, tokens = ['first', 'second', 'third', 'fourth']) {
  return createAflTradeExternalCaptureAdmission({
    redis: createLocalFileCaptureAdmissionStore({ directory }),
    createToken: () => tokens.shift()!,
  });
}

const request = (requestSha256: string, nowMs: number) => ({
  provider: 'draftguru' as const,
  capabilityId: 'draftguru-trade-detail',
  requestSha256,
  policy,
  nowMs,
});

describe('local file capture admission store', () => {
  it('spaces provider fetches five seconds apart across separate store instances', async () => {
    const directory = await stateDirectory();
    const first = await admissionFor(directory).acquire(request('a'.repeat(64), 1_000));
    expect(first.status).toBe('admitted');

    // A second run on the same machine sees the active lease.
    const concurrent = await admissionFor(directory).acquire(request('b'.repeat(64), 2_000));
    expect(concurrent).toEqual({ status: 'deferred', retryAtMs: 121_000 });

    if (first.status !== 'admitted') throw new Error('expected admission');
    await admissionFor(directory).complete(first.lease, {
      outcome: 'succeeded',
      completedAtMs: 3_000,
    });
    expect(await admissionFor(directory).acquire(request('b'.repeat(64), 7_999))).toEqual({
      status: 'deferred',
      retryAtMs: 8_000,
    });
    expect((await admissionFor(directory).acquire(request('b'.repeat(64), 8_000))).status).toBe(
      'admitted'
    );
  });

  it('holds a successful request for the reviewed cache period', async () => {
    const directory = await stateDirectory();
    const admission = admissionFor(directory);
    const first = await admission.acquire(request('a'.repeat(64), 0));
    if (first.status !== 'admitted') throw new Error('expected admission');
    await admission.complete(first.lease, { outcome: 'succeeded', completedAtMs: 10 });
    expect(await admission.acquire(request('a'.repeat(64), 60_000))).toEqual({
      status: 'deferred',
      retryAtMs: 86_400_010,
    });
  });

  it('reports a lost lease rather than completing after expiry', async () => {
    const directory = await stateDirectory();
    const admission = admissionFor(directory);
    const first = await admission.acquire(request('a'.repeat(64), 0));
    if (first.status !== 'admitted') throw new Error('expected admission');
    await expect(
      admission.complete(first.lease, { outcome: 'failed', completedAtMs: 120_001 })
    ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('fails closed on a leftover lock or unreadable state', async () => {
    const directory = await stateDirectory();
    const admission = admissionFor(directory);
    const first = await admission.acquire(request('a'.repeat(64), 0));
    if (first.status !== 'admitted') throw new Error('expected admission');
    const { readdir } = await import('node:fs/promises');
    const [stateFile] = await readdir(directory);
    const lock = join(directory, stateFile!.replace(/\.json$/, '.lock'));
    await writeFile(lock, '');
    await expect(admission.acquire(request('b'.repeat(64), 1))).rejects.toMatchObject({
      code: 'ADMISSION_UNAVAILABLE',
    });
    await rm(lock);
    await writeFile(join(directory, stateFile!), '{not json');
    await expect(admission.acquire(request('b'.repeat(64), 1))).rejects.toMatchObject({
      code: 'ADMISSION_UNAVAILABLE',
    });
  }, 15_000);

  it('requires an absolute state directory', () => {
    expect(() => createLocalFileCaptureAdmissionStore({ directory: 'relative' })).toThrow(
      /absolute/
    );
  });
});
