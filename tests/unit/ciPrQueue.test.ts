import { describe, expect, it } from 'vitest';

import { canUpdateBranches, planQueue, requiredChecksState } from '../../Scripts/ci/pr-queue.mjs';

const pr = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  createdAt: '2026-11-01T00:00:00Z',
  isDraft: false,
  autoMerge: true,
  sameRepository: true,
  mergeStateStatus: 'BEHIND',
  checks: 'SUCCESS',
  headRefName: 'feat/one',
  ...overrides,
});

const check = (name: string, conclusion: string | null = 'SUCCESS', status = 'COMPLETED') => ({
  name,
  status,
  conclusion,
  startedAt: '2026-11-08T00:00:00Z',
});
const ciJob = (name: string, conclusion: string | null = 'SUCCESS', status = 'COMPLETED') => ({
  ...check(name, conclusion, status),
  checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
});
const status = (context: string, state: string) => ({ context, state });

describe('planQueue', () => {
  it('updates the oldest green BEHIND auto-merge pull request', () => {
    const plan = planQueue([
      pr({ number: 3, createdAt: '2026-11-03T00:00:00Z' }),
      pr({ number: 2, createdAt: '2026-11-02T00:00:00Z' }),
    ]);
    expect(plan).toEqual({ action: 'update', candidates: [2, 3] });
  });

  it('waits while another auto-merge pull request is running CI', () => {
    const plan = planQueue([
      pr({ number: 2 }),
      pr({ number: 5, mergeStateStatus: 'BLOCKED', checks: 'PENDING' }),
    ]);
    expect(plan).toEqual({ action: 'wait', number: 5 });
  });

  it('waits while a green, up-to-date pull request is about to merge', () => {
    const plan = planQueue([
      pr({ number: 2 }),
      pr({ number: 5, mergeStateStatus: 'CLEAN', checks: 'SUCCESS' }),
    ]);
    expect(plan).toEqual({ action: 'wait', number: 5 });
  });

  it('skips failed, draft, fork and manual pull requests', () => {
    const plan = planQueue([
      pr({ number: 2, checks: 'FAILURE' }),
      pr({ number: 3, isDraft: true }),
      pr({ number: 4, sameRepository: false }),
      pr({ number: 6, autoMerge: false }),
      pr({ number: 7, mergeStateStatus: 'BLOCKED', checks: 'FAILURE' }),
    ]);
    expect(plan).toEqual({ action: 'none' });
  });

  it('starts CI for an up-to-date pull request whose head has had no checks for ten minutes', () => {
    const stuck = pr({
      number: 8,
      mergeStateStatus: 'BLOCKED',
      checks: null,
      headCommittedAt: '2026-11-07T00:00:00Z',
    });
    const now = Date.parse('2026-11-07T00:11:00Z');
    expect(planQueue([pr({ number: 2 }), stuck], now)).toEqual({
      action: 'dispatch',
      number: 8,
      headRefName: 'feat/one',
    });
  });

  it('waits for a fresh push whose checks have not registered yet', () => {
    const fresh = pr({
      number: 8,
      mergeStateStatus: 'BLOCKED',
      checks: null,
      headCommittedAt: '2026-11-07T00:00:00Z',
    });
    const now = Date.parse('2026-11-07T00:02:00Z');
    expect(planQueue([pr({ number: 2 }), fresh], now)).toEqual({ action: 'wait', number: 8 });
  });

  it('does not wait on a green pull request that is blocked by something CI cannot fix', () => {
    const plan = planQueue([
      pr({ number: 2 }),
      pr({ number: 9, mergeStateStatus: 'BLOCKED', checks: 'SUCCESS' }),
    ]);
    expect(plan).toEqual({ action: 'update', candidates: [2] });
  });

  it('leaves a pull request whose merge state GitHub has not computed yet', () => {
    expect(planQueue([pr({ mergeStateStatus: 'UNKNOWN' })])).toEqual({ action: 'none' });
  });

  it('updates a BEHIND pull request whose CI Gate is green although DeepSource failed', () => {
    const checks = requiredChecksState([
      ciJob('Lint'),
      ciJob('CI Gate'),
      check('GitGuardian Security Checks'),
      status('DeepSource: JavaScript', 'FAILURE'),
      check('CodeFactor', 'FAILURE'),
    ]);
    expect(planQueue([pr({ number: 1231, checks })])).toEqual({
      action: 'update',
      candidates: [1231],
    });
  });

  it('does not update a BEHIND pull request whose CI Gate failed', () => {
    const checks = requiredChecksState([
      ciJob('CI Gate', 'FAILURE'),
      check('GitGuardian Security Checks'),
    ]);
    expect(planQueue([pr({ checks })])).toEqual({ action: 'none' });
  });

  it('waits on an up-to-date pull request still running CI although DeepSource already failed', () => {
    const checks = requiredChecksState([
      ciJob('Lint'),
      ciJob('Unit tests', null, 'IN_PROGRESS'),
      check('GitGuardian Security Checks'),
      status('DeepSource: JavaScript', 'FAILURE'),
    ]);
    const plan = planQueue([
      pr({ number: 2 }),
      pr({ number: 5, mergeStateStatus: 'BLOCKED', checks }),
    ]);
    expect(plan).toEqual({ action: 'wait', number: 5 });
  });
});

describe('requiredChecksState', () => {
  it('reads no CI job as null, so the dispatch grace applies', () => {
    expect(requiredChecksState([])).toBeNull();
    expect(requiredChecksState([check('GitGuardian Security Checks')])).toBeNull();
  });

  it('counts only CI Gate and GitGuardian, not DeepSource or CodeFactor', () => {
    expect(
      requiredChecksState([
        ciJob('CI Gate'),
        check('GitGuardian Security Checks'),
        status('DeepSource: JavaScript', 'FAILURE'),
        check('CodeFactor', 'FAILURE'),
      ])
    ).toBe('SUCCESS');
  });

  it('is PENDING while CI jobs run and CI Gate has not reported', () => {
    expect(
      requiredChecksState([ciJob('Lint', 'FAILURE'), check('GitGuardian Security Checks')])
    ).toBe('PENDING');
    expect(
      requiredChecksState([
        ciJob('CI Gate'),
        check('GitGuardian Security Checks', null, 'IN_PROGRESS'),
      ])
    ).toBe('PENDING');
  });

  it('is FAILURE when a required check failed or never reported', () => {
    expect(
      requiredChecksState([ciJob('CI Gate'), check('GitGuardian Security Checks', 'FAILURE')])
    ).toBe('FAILURE');
    expect(requiredChecksState([ciJob('CI Gate')])).toBe('FAILURE');
  });

  it('judges a re-run required check by its latest run', () => {
    const rerun = { ...ciJob('CI Gate'), startedAt: '2026-11-08T01:00:00Z' };
    expect(
      requiredChecksState([
        ciJob('CI Gate', 'FAILURE'),
        rerun,
        check('GitGuardian Security Checks'),
      ])
    ).toBe('SUCCESS');
  });
});

describe('canUpdateBranches', () => {
  it('updates branches only with the owner token, so CI runs on the new head without approval', () => {
    expect(canUpdateBranches({ QUEUE_TOKEN_SET: 'true' })).toBe(true);
  });

  it('refuses with only GITHUB_TOKEN, whose merge commit leaves pull_request CI awaiting approval', () => {
    expect(canUpdateBranches({ QUEUE_TOKEN_SET: 'false' })).toBe(false);
    expect(canUpdateBranches({})).toBe(false);
  });
});
