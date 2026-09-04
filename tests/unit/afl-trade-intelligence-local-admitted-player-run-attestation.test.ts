import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectExactCleanAflTradeCheckout,
  localAflTradeAdmittedPlayerCandidateConfiguration,
  localAflTradeAdmittedPlayerExecutingCheckoutRoot,
  localAflTradeLoadedPlayerImplementationEvidence,
  reauthenticateExactCleanAflTradeCheckout,
  reauthenticateLoadedAflTradePlayerImplementation,
} from '@/server/aflTradeIntelligence/development/localAdmittedPlayerRunAttestation';
import { aflTradePlayerBaselineConfigSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { aflTradePlayerValidationConfigSchema } from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';

const execute = promisify(execFile);
let checkoutRoot: string | undefined;

async function createCleanCheckout() {
  checkoutRoot = await mkdtemp(join(tmpdir(), 'statly-player-attestation-'));
  await writeFile(join(checkoutRoot, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
  await writeFile(join(checkoutRoot, 'model.ts'), 'export const model = 1;\n', 'utf8');
  await execute('git', ['init', '--quiet'], { cwd: checkoutRoot });
  await execute('git', ['config', 'user.name', 'Statly Test'], { cwd: checkoutRoot });
  await execute('git', ['config', 'user.email', 'test@statly.invalid'], { cwd: checkoutRoot });
  await execute('git', ['add', 'package-lock.json', 'model.ts'], { cwd: checkoutRoot });
  await execute('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: checkoutRoot });
  return checkoutRoot;
}

afterEach(async () => {
  if (checkoutRoot !== undefined) await rm(checkoutRoot, { recursive: true, force: true });
  checkoutRoot = undefined;
});

describe('local admitted-player run attestation', () => {
  it('binds operational attestation to the checkout containing the executing module', () => {
    expect(localAflTradeAdmittedPlayerExecutingCheckoutRoot).toBe(
      resolve(import.meta.dirname, '../..')
    );
  });

  it('retains a candidate configuration accepted by the governed model schemas', () => {
    expect(
      aflTradePlayerBaselineConfigSchema.parse(
        localAflTradeAdmittedPlayerCandidateConfiguration.baseline
      )
    ).toEqual(localAflTradeAdmittedPlayerCandidateConfiguration.baseline);
    expect(
      aflTradePlayerValidationConfigSchema.parse(
        localAflTradeAdmittedPlayerCandidateConfiguration.validation
      )
    ).toEqual(localAflTradeAdmittedPlayerCandidateConfiguration.validation);
  });

  it('binds the loaded candidate implementation to its source digests', () => {
    expect(localAflTradeLoadedPlayerImplementationEvidence.fileCount).toBeGreaterThan(100);
    expect(localAflTradeLoadedPlayerImplementationEvidence.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath:
            'src/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate.ts',
        }),
        expect.objectContaining({
          relativePath: 'src/server/aflTradeIntelligence/artifacts/contentAddress.ts',
        }),
      ])
    );
    expect(localAflTradeLoadedPlayerImplementationEvidence.aggregateSha256).toMatch(
      /^[a-f0-9]{64}$/u
    );
    expect(() => reauthenticateLoadedAflTradePlayerImplementation()).not.toThrow();
  });

  it('measures a clean checkout and rejects a later checkout change', async () => {
    const root = await createCleanCheckout();
    const inspected = await inspectExactCleanAflTradeCheckout(root);
    await writeFile(join(root, 'model.ts'), 'export const model = 2;\n', 'utf8');

    await expect(
      reauthenticateExactCleanAflTradeCheckout({
        canonicalRoot: inspected.canonicalRoot,
        codeCommitSha: inspected.codeCommitSha,
        dependencyLockSha256: 'a'.repeat(64),
      })
    ).rejects.toThrow('requires an exact clean Git checkout');
  });
});
