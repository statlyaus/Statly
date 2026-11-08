import { describe, expect, it } from 'vitest';

import { canUpdateBranches, planQueue } from '../../Scripts/ci/pr-queue.mjs';

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
