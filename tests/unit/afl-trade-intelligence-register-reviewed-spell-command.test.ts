import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeAcquisitionSpellRegistrationRule } from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import {
  parseRegisterReviewedSpellArguments,
  reviewedSpellRegistrationInputSchema,
  runRegisterReviewedSpellCommand,
} from '../../Scripts/register-reviewed-acquisition-spell';

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
// Nothing listens on port 1, so any database use surfaces as a connection error.
const unreachable = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:1/outcomes' };
const evidence = createAflTradeCanonicalJsonArtifactRef({ review: 1 }, '2026-09-01T00:00:00.000Z');
const rule = createAflTradeAcquisitionSpellRegistrationRule({
  environment: 'non_production',
  competition: 'AFLM',
  ruleVersion: 'command-test-v1',
  evidence: [evidence],
  createdAt: '2026-09-02T00:00:00.000Z',
});
const validInput = {
  schemaVersion: 'statly-reviewed-spell-registration-input/v1',
  storeId: 'statly-grading-1-artifacts',
  repositoryId: 'reviewed-registration-evidence',
  artifactClass: 'raw_source',
  execution: { environment: 'non_production', competition: 'AFLM' },
  evidence: [{ artifactId: evidence.artifactId, path: '/evidence/review.json' }],
  rule: { record: rule, approvalDecisionId: 'approval-1' },
};
let directory = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'statly-register-spell-'));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('register reviewed spell arguments', () => {
  it('takes one absolute input path and a loopback database', () => {
    expect(parseRegisterReviewedSpellArguments(['--input', '/work/input.json'], loopback)).toEqual({
      databaseUrl: loopback.AFL_OUTCOMES_DATABASE_URL,
      inputPath: '/work/input.json',
    });
  });

  it('refuses a relative input, extra arguments and a remote database', () => {
    expect(() => parseRegisterReviewedSpellArguments(['--input', 'input.json'], loopback)).toThrow(
      'absolute'
    );
    expect(() =>
      parseRegisterReviewedSpellArguments(['--input', '/a.json', '--apply'], loopback)
    ).toThrow('Usage');
    expect(() =>
      parseRegisterReviewedSpellArguments(['--input', '/a.json'], {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@db.example.com:5432/outcomes',
      })
    ).toThrow('loopback');
  });
});

describe('register reviewed spell input', () => {
  it('accepts a reviewed rule with absolute evidence paths', () => {
    expect(reviewedSpellRegistrationInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('refuses fixture scope, relative evidence paths, duplicates and an empty registration', () => {
    const refused = [
      { ...validInput, execution: { environment: 'test_fixture', competition: 'AFLM' } },
      { ...validInput, evidence: [{ artifactId: evidence.artifactId, path: 'review.json' }] },
      { ...validInput, evidence: [...validInput.evidence, ...validInput.evidence] },
      { ...validInput, rule: undefined },
    ];
    for (const input of refused) {
      expect(reviewedSpellRegistrationInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it('validates the input file before it opens a database connection', async () => {
    const inputPath = join(directory, 'invalid.json');
    await writeFile(inputPath, JSON.stringify({ ...validInput, rule: undefined }));
    await expect(
      runRegisterReviewedSpellCommand({ argv: ['--input', inputPath], env: unreachable })
    ).rejects.toThrow('Name a reviewed rule');
  });
});
