import { describe, expect, it, vi } from 'vitest';

import {
  createAflTradeFactualReleaseLifecycle,
  runAflTradeManageFactualReleaseCommand,
} from '../../Scripts/manage-afl-trade-factual-release';

const INPUT_PATH = '/reviewed/factual-release-transition.json';
const RELEASE_ID = `release:${'1'.repeat(64)}`;
const GATE_DECISION_ID = `gate-decision:${'2'.repeat(64)}`;
const EVIDENCE_ID = `incident:${'3'.repeat(64)}`;
const NOW = '2026-11-18T01:02:03.000Z';
const env = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' };
const ledger = { decisions: ['stored-ledger'] };

function registry(state: string, active: boolean) {
  return {
    revision: 9,
    releases: { [RELEASE_ID]: { releaseId: RELEASE_ID, scopeKey: 'afl', state } },
    activeByScope: active ? { afl: { releaseId: RELEASE_ID } } : {},
    events: [],
  };
}

function lifecycle(state = 'withdrawn', active = false) {
  const releases = {
    loadRegistry: vi.fn(),
    register: vi.fn().mockResolvedValue(registry('candidate', false)),
    apply: vi.fn().mockResolvedValue(registry(state, active)),
    captureSelection: vi.fn(),
  };
  const gates = {
    load: vi.fn().mockResolvedValue({ revision: 4, ledger }),
    appendDecision: vi.fn().mockResolvedValue({ revision: 5, ledger, idempotentReplay: false }),
  };
  return {
    releases,
    gates,
    service: createAflTradeFactualReleaseLifecycle({ releases, gates, now: () => NOW }),
  };
}

describe('manage AFL trade factual release command', () => {
  it('withdraws a release with the operator evidence and the current time', async () => {
    const { releases, service } = lifecycle('withdrawn', false);
    const command = {
      action: 'withdraw' as const,
      releaseId: RELEASE_ID,
      expectedRevision: 8,
      actor: 'production-incident-commander',
      evidenceId: EVIDENCE_ID,
      reason: 'Rights incident requires the factual release to stop serving.',
    };

    const result = await service.execute(command);

    expect(releases.apply).toHaveBeenCalledWith({ ...command, occurredAt: NOW });
    expect(result).toEqual({
      action: 'withdraw',
      releaseId: RELEASE_ID,
      state: 'withdrawn',
      registryRevision: 9,
      activeReleaseId: null,
    });
  });

  it('activates against the stored Gate ledger, not one supplied in the input', async () => {
    const { releases, service } = lifecycle('published', true);
    const command = {
      action: 'activate' as const,
      releaseId: RELEASE_ID,
      expectedRevision: 8,
      actor: 'release-operator',
      evidenceId: EVIDENCE_ID,
      environment: 'production',
      gateDecisionId: GATE_DECISION_ID,
      activationAuthorization: { authorizationId: 'reviewed' },
      gateDecisionLedger: { decisions: ['forged'] },
    };

    const result = await service.execute(command);

    expect(releases.apply).toHaveBeenCalledWith({
      ...command,
      occurredAt: NOW,
      gateDecisionLedger: ledger,
      sourceRightsDecisionLedger: ledger,
      factualReviewDecisionLedger: ledger,
    });
    expect(result).toMatchObject({ activeReleaseId: RELEASE_ID });
  });

  it('registers a candidate manifest', async () => {
    const { releases, service } = lifecycle();
    const manifest = { releaseId: RELEASE_ID, content: {} };

    await service.execute({
      action: 'register',
      expectedRevision: 8,
      manifest,
      actor: 'release-operator',
      evidenceId: EVIDENCE_ID,
    });

    expect(releases.register).toHaveBeenCalledWith({
      expectedRevision: 8,
      manifest,
      actor: 'release-operator',
      evidenceId: EVIDENCE_ID,
      occurredAt: NOW,
    });
  });

  it('records a reviewed Gate 4 or Gate 5 decision in the Gate ledger', async () => {
    const { gates, service } = lifecycle();
    const proposal = { gate: 'gate_4' };
    const decision = { decisionId: GATE_DECISION_ID };

    const result = await service.execute({
      action: 'record-gate',
      expectedRevision: 4,
      proposal,
      decision,
    });

    expect(gates.appendDecision).toHaveBeenCalledWith({ expectedRevision: 4, proposal, decision });
    expect(result).toEqual({
      action: 'record-gate',
      gateDecisionId: GATE_DECISION_ID,
      gateRevision: 5,
      idempotentReplay: false,
    });
  });

  it('rejects an unknown action before connecting', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeManageFactualReleaseCommand(
        { argv: ['--input', INPUT_PATH], env },
        {
          readInput: vi.fn().mockResolvedValue({ action: 'delete' }),
          connect,
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it('requires the outcomes database URL', async () => {
    await expect(
      runAflTradeManageFactualReleaseCommand(
        { argv: ['--input', INPUT_PATH], env: {} },
        { readInput: vi.fn(), connect: vi.fn(), writeOutput: vi.fn() }
      )
    ).rejects.toThrow('AFL_OUTCOMES_DATABASE_URL');
  });

  it('prints the transition summary and closes the connection', async () => {
    const summary = {
      action: 'withdraw',
      releaseId: RELEASE_ID,
      state: 'withdrawn',
      registryRevision: 9,
      activeReleaseId: null,
    };
    const execute = vi.fn().mockResolvedValue(summary);
    const close = vi.fn().mockResolvedValue(undefined);
    const writeOutput = vi.fn();

    await runAflTradeManageFactualReleaseCommand(
      { argv: ['--input', INPUT_PATH], env },
      {
        readInput: vi.fn().mockResolvedValue({ action: 'withdraw' }),
        connect: vi.fn().mockResolvedValue({ execute, close }),
        writeOutput,
      }
    );

    expect(execute).toHaveBeenCalledWith({ action: 'withdraw' });
    expect(close).toHaveBeenCalledOnce();
    expect(writeOutput).toHaveBeenCalledWith(JSON.stringify(summary));
  });
});
