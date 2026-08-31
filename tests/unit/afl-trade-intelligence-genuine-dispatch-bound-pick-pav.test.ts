import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createGenuineDispatchBoundPickPavRunner } from '@/server/aflTradeIntelligence/valuation/genuineDispatchBoundPickPav';
import { PostgresGenuineDispatchBoundPickPavMaterializer } from '@/server/aflTradeIntelligence/valuation/postgresGenuineDispatchBoundPickPav';
import { createAflTradeGenuineDispatchBoundGovernedPickExecutor } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationModelPair';
import {
  createAflTradePrivateValuationModelOperation,
  createAflTradePrivateValuationModelPairCoordinator,
} from '@/server/aflTradeIntelligence/valuation/privateValuationModelPair';

import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';

const sha = (character: string) => character.repeat(64);
const addressed = (prefix: string, value: string) =>
  createAflTradeContentAddress(prefix, { test: value });

function executionInput() {
  const fixture = createGovernedPickPavModelExecutionFixture().execution.content;
  const exactInput = {
    requestId: addressed('private-valuation-dispatch', 'request'),
    scopeKey: 'afl-men:2026-trades',
    factualOutputId: addressed('private-valuation-factual-output', 'factual'),
    hpnCalculationId: addressed('hpn-pav-season', 'hpn'),
    substantive: {
      factualValuesSha256: sha('1'),
      hpnValuesSha256: sha('2'),
      hpnMethodId: fixture.methodId,
      player: {
        modelId: 'player-model',
        modelVersion: 'v1',
        protocolId: addressed('model-protocol', 'player-protocol'),
        datasetId: addressed('dataset', 'player-dataset'),
        datasetAdmissionId: addressed('dataset-admission', 'player-admission'),
      },
      pick: {
        protocolId: fixture.protocolId,
        datasetId: fixture.datasetId,
        datasetAdmissionId: fixture.datasetAdmissionId,
        policyId: fixture.policyId,
      },
      qualificationPolicyId: addressed('model-qualification-policy', 'qualification'),
    },
  } as const;
  return {
    fixture,
    input: {
      exactInput,
      operation: createAflTradePrivateValuationModelOperation({
        scopeKey: exactInput.scopeKey,
        ...exactInput.substantive,
      }),
      attemptNumber: 1,
      claim: {
        claimId: addressed('private-valuation-dispatch-claim', 'claim'),
        leaseToken: sha('3'),
      },
    },
  };
}

describe('genuine dispatch-bound pick-PAV runner', () => {
  it('fails closed before release lookup when the exact request binding is absent', async () => {
    const { input } = executionInput();
    const queries: string[] = [];
    const client = {
      async transaction<T>(work: (transaction: typeof client) => Promise<T>): Promise<T> {
        return work(client);
      },
      async query<Row>(sql: string) {
        queries.push(sql);
        return {
          rows: (sql.includes('SELECT factual.output_json') ? [] : [{}]) as Row[],
          rowCount: sql.includes('SELECT factual.output_json') ? 0 : 1,
        };
      },
    };

    await expect(
      new PostgresGenuineDispatchBoundPickPavMaterializer(client).materialize(input)
    ).rejects.toThrow('Exact dispatch-bound pick-PAV authority is unavailable.');
    expect(queries.some((sql) => sql.includes('outcome_active_release'))).toBe(false);
    expect(queries.filter((sql) => sql.includes('load_outcome_private_valuation_dispatch')))
      .toHaveLength(1);
  });

  it('fits and validates the existing methodology from exact retained private authority', async () => {
    const { fixture, input } = executionInput();
    const loadExactAuthority = vi.fn(async () => ({
      observationSet: fixture.observationSet,
      authority: {
        datasetId: fixture.datasetId,
        datasetArtifact: fixture.datasetArtifact,
        datasetAdmissionId: fixture.datasetAdmissionId,
        datasetAdmissionArtifact: fixture.datasetAdmissionArtifact,
        datasetAdmissionGateLedgerRevision: fixture.datasetAdmissionGateLedgerRevision,
        protocolId: fixture.protocolId,
        protocolArtifact: fixture.protocolArtifact,
      },
      benchmarkConfig: fixture.benchmarkConfig,
      validationConfig: fixture.validationConfig,
      completedAt: fixture.completedAt,
      registeredAt: '2015-01-03T00:00:02.000Z',
    }));
    const runner = createGenuineDispatchBoundPickPavRunner({ loadExactAuthority });

    const result = await runner(input);

    expect(loadExactAuthority).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      outputs: {
        observationSet: { observationSetId: fixture.observationSetId },
        benchmark: { benchmarkId: fixture.benchmark.benchmarkId },
        validationReport: { validationReportId: fixture.validationReport.validationReportId },
      },
      authority: {
        datasetId: input.operation.content.pick.datasetId,
        datasetAdmissionId: input.operation.content.pick.datasetAdmissionId,
        protocolId: input.operation.content.pick.protocolId,
      },
      completedAt: fixture.completedAt,
    });
  });

  it('fails closed when retained authority belongs to another substantive target', async () => {
    const { fixture, input } = executionInput();
    const runner = createGenuineDispatchBoundPickPavRunner({
      loadExactAuthority: async () => ({
        observationSet: fixture.observationSet,
        authority: {
          datasetId: addressed('dataset', 'another'),
          datasetArtifact: fixture.datasetArtifact,
          datasetAdmissionId: fixture.datasetAdmissionId,
          datasetAdmissionArtifact: fixture.datasetAdmissionArtifact,
          datasetAdmissionGateLedgerRevision: fixture.datasetAdmissionGateLedgerRevision,
          protocolId: fixture.protocolId,
          protocolArtifact: fixture.protocolArtifact,
        },
        benchmarkConfig: fixture.benchmarkConfig,
        validationConfig: fixture.validationConfig,
        completedAt: fixture.completedAt,
        registeredAt: '2015-01-03T00:00:02.000Z',
      }),
    });

    await expect(runner(input)).rejects.toThrow(
      'Genuine pick-PAV authority does not match the dispatch-bound target.'
    );
  });

  it('retains the genuine native execution and component manifest', async () => {
    const { fixture, input } = executionInput();
    const documents: unknown[] = [];
    const registerExecution = vi.fn(async (value) => value);
    const registerComponent = vi.fn(async (value) => value);
    const assertClaim = vi.fn(async () => undefined);
    const executor = createAflTradeGenuineDispatchBoundGovernedPickExecutor({
      assertClaim,
      loadExactAuthority: async () => ({
        observationSet: fixture.observationSet,
        authority: {
          datasetId: fixture.datasetId,
          datasetArtifact: fixture.datasetArtifact,
          datasetAdmissionId: fixture.datasetAdmissionId,
          datasetAdmissionArtifact: fixture.datasetAdmissionArtifact,
          datasetAdmissionGateLedgerRevision: fixture.datasetAdmissionGateLedgerRevision,
          protocolId: fixture.protocolId,
          protocolArtifact: fixture.protocolArtifact,
        },
        benchmarkConfig: fixture.benchmarkConfig,
        validationConfig: fixture.validationConfig,
        completedAt: fixture.completedAt,
        registeredAt: '2015-01-03T00:00:02.000Z',
      }),
      retainArtifact: async ({ document, createdAt }) => {
        documents.push(document);
        return createAflTradeCanonicalJsonArtifactRef(document, createdAt);
      },
      executionRepository: { register: registerExecution },
      componentRepository: { register: registerComponent },
    });

    const result = await executor.execute(input);

    expect(result.state).toBe('completed');
    expect(documents).toMatchObject([
      {
        content: {
          schemaVersion: 'afl-trade-pick-pav-model-execution/v4',
          privateInput: {
            requestId: input.exactInput.requestId,
            operationId: input.operation.operationId,
            claimId: input.claim.claimId,
            attemptNumber: 1,
            factualOutputId: input.exactInput.factualOutputId,
            hpnCalculationId: input.exactInput.hpnCalculationId,
          },
        },
      },
      {
        content: {
          role: 'draft_pick_and_future_pick_distribution',
          nativeExecution: { kind: 'governed_pick_pav_model_execution' },
        },
      },
    ]);
    expect(assertClaim).toHaveBeenCalledTimes(3);
  });

  it('does not retain execution artifacts after the dispatch claim is lost', async () => {
    const { fixture, input } = executionInput();
    const retainArtifact = vi.fn();
    const executor = createAflTradeGenuineDispatchBoundGovernedPickExecutor({
      loadExactAuthority: async () => ({
        observationSet: fixture.observationSet,
        authority: {
          datasetId: fixture.datasetId,
          datasetArtifact: fixture.datasetArtifact,
          datasetAdmissionId: fixture.datasetAdmissionId,
          datasetAdmissionArtifact: fixture.datasetAdmissionArtifact,
          datasetAdmissionGateLedgerRevision: fixture.datasetAdmissionGateLedgerRevision,
          protocolId: fixture.protocolId,
          protocolArtifact: fixture.protocolArtifact,
        },
        benchmarkConfig: fixture.benchmarkConfig,
        validationConfig: fixture.validationConfig,
        completedAt: fixture.completedAt,
        registeredAt: '2015-01-03T00:00:02.000Z',
      }),
      assertClaim: async () => {
        throw Object.assign(new Error('claim was reclaimed'), { code: 'STALE_GATE_LEDGER' });
      },
      retainArtifact,
      executionRepository: { register: vi.fn() },
      componentRepository: { register: vi.fn() },
    });

    await expect(executor.execute(input)).resolves.toMatchObject({ state: 'stale_authority' });
    expect(retainArtifact).not.toHaveBeenCalled();
  });

  it('restarts from a retained pick run without repeating successful pick work', async () => {
    const { input } = executionInput();
    const pickRunId = addressed('model-run', 'retained-pick');
    const playerRunId = addressed('model-run', 'retained-player');
    const qualificationId = addressed('model-qualification', 'retained-qualification');
    const executePick = vi.fn();
    const state = {
      operation: input.operation,
      attemptNumber: 1,
      playerRunId,
      pickRunId,
      pairAccepted: true,
      qualificationId: null,
      qualificationOutcome: null,
    };
    const coordinator = createAflTradePrivateValuationModelPairCoordinator({
      prepareExactInput: async () => input.exactInput,
      repository: {
        bindInput: async () => state,
        acceptComponent: vi.fn(),
        acceptPair: vi.fn(),
        bindQualification: async () => ({
          ...state,
          qualificationId,
          qualificationOutcome: 'qualified' as const,
        }),
      },
      executePlayer: vi.fn(),
      executePick,
      qualify: async () => ({ qualificationId, outcome: 'qualified' as const }),
    });

    await expect(
      coordinator.prepare({ requestId: input.exactInput.requestId, claim: input.claim })
    ).resolves.toMatchObject({ state: 'qualified', qualificationId });
    expect(executePick).not.toHaveBeenCalled();
  });

  it.each([
    [new TypeError('invalid retained authority'), 'deterministic_failure'],
    [
      Object.assign(
        new Error('Private valuation dispatch request lookup lost its live claim fence'),
        { code: 'P0001' }
      ),
      'stale_authority',
    ],
    [Object.assign(new Error('database unavailable'), { code: '08006' }), 'transient_failure'],
  ] as const)('classifies model failures for the dispatch attempt ledger', async (error, state) => {
    const { input } = executionInput();
    const executor = createAflTradeGenuineDispatchBoundGovernedPickExecutor({
      loadExactAuthority: async () => {
        throw error;
      },
      assertClaim: vi.fn(),
      retainArtifact: vi.fn(),
      executionRepository: { register: vi.fn() },
      componentRepository: { register: vi.fn() },
    });

    await expect(executor.execute(input)).resolves.toMatchObject({ state });
  });
});
