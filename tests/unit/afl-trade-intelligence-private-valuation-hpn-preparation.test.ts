import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import {
  createAflTradeAdmittedPlayerFactualOutput,
  createAflTradePrivateValuationFactualOutput,
} from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
import { createAflTradePrivateValuationHpnSourceAdmission } from '@/server/aflTradeIntelligence/valuation/privateValuationHpnSourceAdmission';
import {
  aflTradePrivateValuationDispatchRequestSchema,
  createAflTradePrivateValuationDispatchRequestId,
} from '@/server/aflTradeIntelligence/valuation/privateValuationScheduling';
import { PostgresAflTradePrivateValuationHpnPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnPreparation';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const claim = {
  claimId: addressed('private-valuation-dispatch-claim', 'hpn-claim'),
  leaseToken: sha('hpn-lease'),
};
const requestContent = {
  scopeKey: 'afl-men:2026-trades',
  trigger: 'ad_hoc' as const,
  scheduledFor: '2026-08-12T00:00:00.000Z',
  authorityKey: 'hpn-preparation-test',
};
const request = aflTradePrivateValuationDispatchRequestSchema.parse({
  requestId: createAflTradePrivateValuationDispatchRequestId(requestContent),
  ...requestContent,
});

class PreparationSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly events: string[] = [];
  heartbeatCount = 0;
  failHeartbeatAt: number | undefined;
  hpnFactualBinding: unknown = null;

  constructor(private readonly retainedRequest = request) {}

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.startsWith('SET LOCAL ROLE')) return this.result([]);
    if (sql.startsWith('RESET ROLE')) return this.result([]);
    if (sql.includes('load_outcome_private_valuation_hpn_factual_input')) {
      return this.result([{ binding_json: this.hpnFactualBinding }]);
    }
    if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
      this.events.push('claim-check');
      return this.result([{ request_json: this.retainedRequest }]);
    }
    if (sql.includes('heartbeat_outcome_private_valuation_dispatch')) {
      this.heartbeatCount += 1;
      this.events.push('heartbeat');
      if (this.heartbeatCount === this.failHeartbeatAt) {
        throw new Error('Private valuation dispatch claim was lost');
      }
      return this.result([{ heartbeat_outcome_private_valuation_dispatch: null }]);
    }
    if (sql.includes('max(capture.captured_at)')) {
      return this.result([{ effective_through: '2026-08-12T00:03:00.000Z' }]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  private result<Row>(rows: readonly unknown[]): AflOutcomeSqlQueryResult<Row> {
    return { rows: rows as readonly Row[], rowCount: rows.length };
  }
}

function factualOutput() {
  return createAflTradePrivateValuationFactualOutput({
    requestId: request.requestId,
    valuationScopeKey: request.scopeKey,
    captureBindingId: addressed('private-valuation-capture-binding', 'factual'),
    sourceAdmissionId: addressed('private-valuation-source-admission', 'source-admission'),
    normalizationRunId: addressed('provider-normalization-run', 'factual'),
    factBatch: {
      batchId: addressed('source-fact-batch', 'fact-batch'),
      batchSha256: sha('fact-batch'),
    },
    reconciliation: {
      factualRunId: addressed('factual-reconciliation-run', 'factual-run'),
      runSha256: sha('factual-run'),
      outputSetSha256: sha('factual-output'),
      finalizedAt: '2026-08-12T00:01:00.000Z',
    },
    spellMetricBatches: [
      {
        batchId: addressed('acquisition-spell-metric-batch', 'spell-batch'),
        batchSha256: sha('spell-batch'),
      },
    ],
    candidate: {
      candidateId: addressed('factual-release-candidate', 'candidate'),
      candidateSha256: sha('candidate'),
      memberSetSha256: sha('members'),
    },
    factualRelease: {
      releaseId: addressed('outcome-release', 'release'),
      releaseSha256: sha('release'),
    },
    preparedAt: '2026-08-12T00:02:00.000Z',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function admittedFactualOutput() {
  const legacy = factualOutput().content;
  return createAflTradeAdmittedPlayerFactualOutput({
    requestId: legacy.requestId,
    valuationScopeKey: legacy.valuationScopeKey,
    admittedPlayerDataset: {
      datasetId: addressed('dataset', 'player'),
      admissionId: addressed('dataset-admission', 'player'),
    },
    sourceCaptures: [
      {
        captureId: addressed('source-capture', 'player'),
        sourceSnapshotId: addressed('source-snapshot', 'player'),
        consumedFieldSetId: addressed('consumed-field-set', 'player'),
        consumedFieldSetSha256: sha('player-fields'),
      },
    ],
    spellMetricBatches: legacy.spellMetricBatches,
    candidate: legacy.candidate,
    factualRelease: legacy.factualRelease,
    preparedAt: legacy.preparedAt,
  });
}

describe('private valuation HPN preparation', () => {
  it('carries explicit source-first custody through real capture owners without recapture on replay', async () => {
    const bindings = new Map<string, unknown>();
    const acceptedRoles: string[] = [];
    let captures = 0;
    const base = new PreparationSqlClient();
    const authorities = {
      hpn_completed_results: createLocalAflTradeAflTablesResultsAuthority(2026),
      hpn_primary_player_stats: createLocalAflTradeFiveSeasonAflTablesAuthority(2026),
      hpn_corroborating_player_stats: createLocalAflTradeOfficialAfl2026Authority(),
    };
    const sql: AflOutcomeSqlClient = {
      transaction: (work) => work(sql),
      async query<Row>(statement: string, parameters: readonly unknown[] = []) {
        let rows: unknown[];
        if (statement.includes('FROM outcome_private_valuation_capture_binding')) {
          const binding = bindings.get(String(parameters[1]));
          rows = binding ? [{ binding_json: binding }] : [];
        } else if (statement.includes('accept_outcome_private_valuation_source_first_capture')) {
          const role = String(parameters[3]) as keyof typeof authorities;
          const authority = authorities[role];
          expect(parameters.slice(0, 3)).toEqual([
            request.requestId,
            claim.claimId,
            sha(claim.leaseToken),
          ]);
          const content = {
            schemaVersion: 'afl-trade-private-valuation-capture-binding/v3',
            authorityKind: 'source_first',
            request,
            sourceRole: role,
            dispatchClaimId: claim.claimId,
            attemptSequence: 1,
            attemptNumber: 1,
            sourcePlan: {
              provider: authority.capture.sourceRights.content.provider,
              dataset: authority.capture.sourceRights.content.dataset,
              capabilityId: authority.capture.gateRequest.capabilityId,
              fieldMapId: authority.fieldMap.mapId,
              rightsArtifactId: authority.capture.sourceRights.rightsArtifactId,
              competition: 'AFLM',
              seasonYear: 2026,
              gate0AReceiptId: addressed('gate0a-evaluation', role),
            },
            sourceCaptureAttemptId: addressed('source-capture-attempt', role),
            captureReceiptId: addressed('fitzroy-capture', role),
            snapshotId: addressed('source-snapshot', role),
            sourceCaptureId: addressed('source-capture', role),
            normalizationRunId: parameters[4],
            acceptedAt: '2026-08-12T00:03:00.000Z',
            environment: 'non_production',
            publicationEligible: false,
            limitation:
              'Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.',
          };
          const binding = {
            bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
            content,
          };
          bindings.set(role, binding);
          acceptedRoles.push(role);
          rows = [{ binding_json: binding }];
        } else if (statement.includes('outcome_hpn_projected_field_map')) {
          throw new Error('Explicit test boundary: projected map authority not supplied');
        } else {
          return base.query<Row>(statement);
        }
        return { rows: rows as Row[], rowCount: rows.length };
      },
    };
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(sql, {
      captureAuthority: 'source_first',
      factualPreparation: { prepare: async () => ({ state: 'prepared', output: factualOutput() }) },
      methodId: addressed('hpn-pav-method', 'method'),
      methodAuthority: { loadExact: vi.fn() },
      captureSource: async ({ sourceRole }) => {
        captures += 1;
        return { normalizationRunId: addressed('provider-normalization-run', sourceRole) };
      },
    });
    await expect(preparation.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      'projected map authority not supplied'
    );
    expect(acceptedRoles).toEqual([
      'hpn_completed_results',
      'hpn_primary_player_stats',
      'hpn_corroborating_player_stats',
    ]);
    await expect(preparation.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      'projected map authority not supplied'
    );
    expect(captures).toBe(3);
    expect(acceptedRoles).toHaveLength(3);
    const role = 'hpn_completed_results';
    const v3 = bindings.get(role) as { content: Record<string, unknown> };
    const { authorityKind: _authorityKind, ...withoutKind } = v3.content;
    const legacyContent = {
      ...withoutKind,
      schemaVersion: 'afl-trade-private-valuation-capture-binding/v2',
    };
    bindings.set(role, {
      bindingId: createAflTradeContentAddress('private-valuation-capture-binding', legacyContent),
      content: legacyContent,
    });
    await expect(preparation.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      /authority/i
    );
    expect(captures).toBe(3);
    bindings.set(role, v3);
    const legacy = new PostgresAflTradePrivateValuationHpnPreparation(sql, {
      factualPreparation: { prepare: async () => ({ state: 'prepared', output: factualOutput() }) },
      methodId: addressed('hpn-pav-method', 'method'),
      methodAuthority: { loadExact: vi.fn() },
      captureSource: async () => {
        throw new Error('Mixed custody must not recapture');
      },
    });
    await expect(legacy.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      /authority/i
    );
  });

  it('rejects admitted-player output without current bound HPN factual authority before capture', async () => {
    const output = admittedFactualOutput();
    let captured = false;
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(
      new PreparationSqlClient(),
      {
        factualPreparation: { prepare: async () => ({ state: 'prepared', output }) },
        methodId: addressed('hpn-pav-method', 'method'),
        methodAuthority: { loadExact: vi.fn() },
        captureSource: async () => {
          captured = true;
          throw new Error('Capture must not start without factual authority.');
        },
      }
    );
    await expect(preparation.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      'Current admitted-player HPN factual binding is unavailable.'
    );
    expect(captured).toBe(false);
  });

  it.each(['legacy', 'admitted', 'source_first'] as const)(
    'composes %s factual input and three capture lanes through the existing HPN owners',
    async (kind) => {
      const sqlClient = new PreparationSqlClient();
      const output = kind === 'legacy' ? factualOutput() : admittedFactualOutput();
      const factualRunId =
        kind === 'legacy'
          ? factualOutput().content.reconciliation.factualRunId
          : addressed('factual-reconciliation-run', 'explicit-hpn-universe');
      sqlClient.hpnFactualBinding = {
        requestId: request.requestId,
        factualOutputId: output.outputId,
        factualOperationId: addressed('current-valuation-factual-refresh-operation', 'current'),
        privateFactualCandidateId: addressed('private-factual-candidate', 'current'),
        privateFactualRevision: 1,
        hpnFactualRunId: factualRunId,
        hpnInputSetSha256: sha('hpn-factual-inputs'),
        hpnFinalizedAt: '2026-08-12T00:01:00.000Z',
      };
      const roles = [
        'hpn_completed_results',
        'hpn_primary_player_stats',
        'hpn_corroborating_player_stats',
      ] as const;
      const sourcePlanByRole = {
        hpn_completed_results: {
          provider: 'afl_tables',
          dataset: 'AFL Tables completed match results through fitzRoy',
          capabilityId: 'afl-tables-results',
          fieldMapId: createLocalAflTradeAflTablesResultsAuthority(2026).fieldMap.mapId,
          rightsArtifactId:
            createLocalAflTradeAflTablesResultsAuthority(2026).capture.sourceRights
              .rightsArtifactId,
        },
        hpn_primary_player_stats: {
          provider: 'afl_tables',
          dataset: 'AFL Tables historical player match statistics',
          capabilityId: 'afl-tables-player-stats',
          fieldMapId: createLocalAflTradeFiveSeasonAflTablesAuthority(2026).fieldMap.mapId,
          rightsArtifactId:
            createLocalAflTradeFiveSeasonAflTablesAuthority(2026).capture.sourceRights
              .rightsArtifactId,
        },
        hpn_corroborating_player_stats: {
          provider: 'official_afl',
          dataset: 'Official AFL 2026 player match statistics',
          capabilityId: 'official-afl-player-stats',
          fieldMapId: createLocalAflTradeOfficialAfl2026Authority().fieldMap.mapId,
          rightsArtifactId:
            createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights.rightsArtifactId,
        },
      } as const;
      const retainedBindings = new Map<
        string,
        Awaited<ReturnType<PostgresAflTradePrivateValuationCaptureBindingRepository['accept']>>
      >();
      const loadBinding = vi
        .spyOn(PostgresAflTradePrivateValuationCaptureBindingRepository.prototype, 'load')
        .mockImplementation(
          async (_request, sourceRole = 'factual_input') => retainedBindings.get(sourceRole) ?? null
        );
      const acceptBinding = vi
        .spyOn(
          PostgresAflTradePrivateValuationCaptureBindingRepository.prototype,
          kind === 'source_first' ? 'acceptSourceFirst' : 'accept'
        )
        .mockImplementation(async ({ sourceRole, normalizationRunId }) => {
          const exactRole = sourceRole as (typeof roles)[number];
          const sourcePlan = sourcePlanByRole[exactRole];
          const content = {
            ...(kind === 'source_first'
              ? {
                  schemaVersion: 'afl-trade-private-valuation-capture-binding/v3' as const,
                  authorityKind: 'source_first' as const,
                }
              : { schemaVersion: 'afl-trade-private-valuation-capture-binding/v2' as const }),
            request,
            sourceRole: exactRole,
            dispatchClaimId: claim.claimId,
            attemptSequence: 1,
            attemptNumber: 1,
            sourcePlan: {
              ...sourcePlan,
              competition: 'AFLM' as const,
              seasonYear: 2026,
              gate0AReceiptId: addressed('gate0a-evaluation', exactRole),
            },
            sourceCaptureAttemptId: addressed('source-capture-attempt', exactRole),
            captureReceiptId: addressed('fitzroy-capture', exactRole),
            snapshotId: addressed('source-snapshot', exactRole),
            sourceCaptureId: addressed('source-capture', exactRole),
            normalizationRunId,
            acceptedAt: '2026-08-12T00:03:00.000Z',
            environment: 'non_production' as const,
            publicationEligible: false as const,
            limitation:
              'Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.' as const,
          };
          const binding = {
            bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
            content,
          };
          retainedBindings.set(exactRole, binding);
          return binding;
        });
      const selectedMaps = vi
        .spyOn(PostgresAflTradeHpnProjectedFieldMapAuthority.prototype, 'loadCurrentForSource')
        .mockImplementation(
          async ({ inputKind, provider }) =>
            ({
              fieldMapId: addressed('hpn-pav-field-map', `${provider}:${inputKind}`),
            }) as never
        );
      const buildInput = vi
        .spyOn(PostgresAflTradeHpnPavInputRepository.prototype, 'buildAndPersistSeasonInputSet')
        .mockImplementation(async () => {
          sqlClient.events.push('input');
          return {
            inputSet: { inputSetId: addressed('hpn-pav-input-set', 'input') } as never,
            idempotentReplay: false,
          };
        });
      const retainedAdmissions = new Map<
        (typeof roles)[number],
        ReturnType<typeof createAflTradePrivateValuationHpnSourceAdmission>
      >();
      const admitHpnSource = vi
        .spyOn(PostgresAflTradePrivateValuationCaptureBindingRepository.prototype, 'admitHpnSource')
        .mockImplementation(async ({ binding, projectedFieldMapId }) => {
          if (binding.content.schemaVersion === 'afl-trade-private-valuation-capture-binding/v1') {
            throw new TypeError('The unit fixture requires role-aware capture custody.');
          }
          const sourceRole = binding.content.sourceRole as (typeof roles)[number];
          const retained = retainedAdmissions.get(sourceRole);
          if (retained !== undefined) {
            return { state: 'already_admitted', admission: retained };
          }
          const admission = createAflTradePrivateValuationHpnSourceAdmission({
            requestId: request.requestId,
            dispatchClaimId: claim.claimId,
            attemptSequence: binding.content.attemptSequence,
            attemptNumber: binding.content.attemptNumber,
            sourceRole,
            captureBindingId: binding.bindingId,
            sourceCaptureId: binding.content.sourceCaptureId,
            normalizationRunId: binding.content.normalizationRunId,
            projectedFieldMapId,
            admittedAt: '2026-08-12T00:04:00.000Z',
          });
          retainedAdmissions.set(sourceRole, admission);
          return { state: 'admitted', admission };
        });
      const calculate = vi
        .spyOn(PostgresAflTradeHpnPavCalculationRepository.prototype, 'calculateAndPersist')
        .mockImplementation(async () => {
          sqlClient.events.push('calculation');
          return {
            calculation: { calculationId: addressed('hpn-pav-season', 'calculation') } as never,
            idempotentReplay: false,
          };
        });
      const captureSource = vi.fn(async ({ sourceRole }: { sourceRole: string }) => ({
        normalizationRunId: addressed('provider-normalization-run', sourceRole),
      }));
      const prepareFactual = vi
        .fn()
        .mockResolvedValueOnce({ state: 'prepared' as const, output })
        .mockResolvedValue({ state: 'already_prepared' as const, output });
      const preparation = new PostgresAflTradePrivateValuationHpnPreparation(sqlClient, {
        ...(kind === 'source_first' ? { captureAuthority: 'source_first' as const } : {}),
        factualPreparation: { prepare: prepareFactual },
        methodId: addressed('hpn-pav-method', 'method'),
        methodAuthority: { loadExact: vi.fn() },
        captureSource,
      });

      const retainedInputCustody = {
        requestId: request.requestId,
        factualOutputId: output.outputId,
        factualRunId,
        sources: roles.map((sourceRole) => ({
          sourceRole,
          captureId: addressed('source-capture', sourceRole),
          normalizationRunId: addressed('provider-normalization-run', sourceRole),
        })),
        knowledgePolicy: 'retrospective_as_recorded_by_input_creation' as const,
        knowledgeCutoffAt: '2026-08-12T00:05:00.000Z',
        reviewedNonparticipantDecisions: [
          addressed('review-decision', 'unused-primary'),
          addressed('review-decision', 'unused-corroborating'),
        ],
      };
      const preparationInput = {
        requestId: request.requestId,
        claim,
        ...(kind === 'source_first' ? { retainedInputCustody } : {}),
      };
      await expect(preparation.prepare(preparationInput)).resolves.toEqual({
        state: 'prepared',
        requestId: request.requestId,
        factualOutputId: output.outputId,
        inputSetId: addressed('hpn-pav-input-set', 'input'),
        calculationId: addressed('hpn-pav-season', 'calculation'),
        captureBindingIds: roles.map((_role) =>
          expect.stringMatching(/^private-valuation-capture-binding:[a-f0-9]{64}$/u)
        ),
        sourceAdmissionIds: roles.map((_role) =>
          expect.stringMatching(/^private-valuation-hpn-source-admission:[a-f0-9]{64}$/u)
        ),
        publicationEligible: false,
      });
      expect(loadBinding).toHaveBeenCalledTimes(3);
      expect(acceptBinding).toHaveBeenCalledTimes(3);
      expect(captureSource.mock.calls.map(([input]) => input.sourceRole)).toEqual(roles);
      expect(selectedMaps).toHaveBeenCalledTimes(3);
      expect(admitHpnSource).toHaveBeenCalledTimes(3);
      for (const [admissionInput] of admitHpnSource.mock.calls.slice(0, 3)) {
        expect(admissionInput.factualOutputId).toBe(output.outputId);
      }
      expect(Math.max(...admitHpnSource.mock.invocationCallOrder)).toBeLessThan(
        buildInput.mock.invocationCallOrder[0]!
      );
      expect(buildInput).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'non_production',
          competition: 'AFLM',
          seasonYear: 2026,
          factualRunId,
          sources: expect.arrayContaining([
            expect.objectContaining({ inputKind: 'completed_match_result', role: null }),
            expect.objectContaining({ inputKind: 'player_match_stats', role: 'primary' }),
            expect.objectContaining({ inputKind: 'player_match_stats', role: 'corroborating' }),
          ]),
        }),
        { environment: 'non_production' }
      );
      expect(calculate).toHaveBeenCalledTimes(1);
      if (kind === 'source_first')
        expect(buildInput.mock.calls[0]![0]).toMatchObject({
          knowledgePolicy: retainedInputCustody.knowledgePolicy,
          knowledgeCutoffAt: retainedInputCustody.knowledgeCutoffAt,
          reviewedNonparticipantDecisions: retainedInputCustody.reviewedNonparticipantDecisions,
        });
      expect(sqlClient.events.slice(-4)).toEqual([
        'heartbeat',
        'input',
        'calculation',
        'heartbeat',
      ]);

      buildInput.mockImplementation(async () => {
        sqlClient.events.push('input');
        return {
          inputSet: { inputSetId: addressed('hpn-pav-input-set', 'input') } as never,
          idempotentReplay: true,
        };
      });
      calculate.mockImplementation(async () => {
        sqlClient.events.push('calculation');
        return {
          calculation: { calculationId: addressed('hpn-pav-season', 'calculation') } as never,
          idempotentReplay: true,
        };
      });
      sqlClient.failHeartbeatAt = sqlClient.heartbeatCount + 5;
      await expect(preparation.prepare(preparationInput)).rejects.toThrow(
        'Private valuation dispatch claim was lost'
      );
      expect(sqlClient.events.slice(-3)).toEqual(['input', 'calculation', 'heartbeat']);
      sqlClient.failHeartbeatAt = undefined;
      await expect(preparation.prepare(preparationInput)).resolves.toMatchObject({
        state: 'already_prepared',
        inputSetId: addressed('hpn-pav-input-set', 'input'),
        calculationId: addressed('hpn-pav-season', 'calculation'),
      });
      expect(captureSource).toHaveBeenCalledTimes(3);
      expect(acceptBinding).toHaveBeenCalledTimes(3);
      expect(admitHpnSource).toHaveBeenCalledTimes(9);
      const invalidCustodies =
        kind === 'source_first'
          ? [
              {
                ...retainedInputCustody,
                requestId: addressed('private-valuation-dispatch', 'foreign'),
              },
              {
                ...retainedInputCustody,
                factualOutputId: addressed('private-valuation-factual-output', 'foreign'),
              },
              {
                ...retainedInputCustody,
                factualRunId: addressed('factual-reconciliation-run', 'foreign'),
              },
              { ...retainedInputCustody, sources: retainedInputCustody.sources.slice(1) },
              {
                ...retainedInputCustody,
                sources: [...retainedInputCustody.sources, retainedInputCustody.sources[0]!],
              },
              {
                ...retainedInputCustody,
                sources: retainedInputCustody.sources.map((s, i) =>
                  i === 0 ? { ...s, captureId: addressed('source-capture', 'foreign') } : s
                ),
              },
              {
                ...retainedInputCustody,
                sources: retainedInputCustody.sources.map((s, i) =>
                  i === 0
                    ? {
                        ...s,
                        normalizationRunId: addressed('provider-normalization-run', 'foreign'),
                      }
                    : s
                ),
              },
              {
                ...retainedInputCustody,
                sources: retainedInputCustody.sources.map((s, i) =>
                  i === 0 ? { ...s, sourceRole: roles[1] } : s
                ),
              },
              {
                ...retainedInputCustody,
                reviewedNonparticipantDecisions: [
                  retainedInputCustody.reviewedNonparticipantDecisions[0]!,
                  retainedInputCustody.reviewedNonparticipantDecisions[0]!,
                ],
              },
              { ...retainedInputCustody, knowledgeCutoffAt: 'not-an-instant' },
              { ...retainedInputCustody, knowledgeCutoffAt: '2025-01-01T00:00:00.000Z' },
              { ...retainedInputCustody, knowledgePolicy: undefined },
            ]
          : [retainedInputCustody];
      for (const invalid of invalidCustodies) {
        const builds = buildInput.mock.calls.length;
        await expect(
          preparation.prepare({
            requestId: request.requestId,
            claim,
            retainedInputCustody: invalid as never,
          })
        ).rejects.toThrow();
        expect(buildInput.mock.calls).toHaveLength(builds);
      }
    }
  );

  it('fails closed before HPN persistence when exact accepted source custody is missing', async () => {
    vi.spyOn(
      PostgresAflTradePrivateValuationCaptureBindingRepository.prototype,
      'load'
    ).mockRejectedValue(new Error('No accepted exact source custody.'));
    const buildInput = vi.spyOn(
      PostgresAflTradeHpnPavInputRepository.prototype,
      'buildAndPersistSeasonInputSet'
    );
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(
      new PreparationSqlClient(),
      {
        factualPreparation: {
          prepare: vi.fn(async () => ({ state: 'prepared' as const, output: factualOutput() })),
        },
        methodId: addressed('hpn-pav-method', 'method'),
        methodAuthority: { loadExact: vi.fn() },
        captureSource: vi.fn(),
      }
    );

    await expect(preparation.prepare({ requestId: request.requestId, claim })).rejects.toThrow(
      /exact source custody/i
    );
    expect(buildInput).not.toHaveBeenCalled();
  });

  it('rejects an unsupported dispatch scope before factual or capture work', async () => {
    const unsupportedContent = {
      ...requestContent,
      scopeKey: 'aflw:2026-trades',
      authorityKey: 'unsupported-hpn-scope',
    };
    const unsupportedRequest = aflTradePrivateValuationDispatchRequestSchema.parse({
      requestId: createAflTradePrivateValuationDispatchRequestId(unsupportedContent),
      ...unsupportedContent,
    });
    const prepareFactual = vi.fn();
    const captureSource = vi.fn();
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(
      new PreparationSqlClient(unsupportedRequest),
      {
        factualPreparation: { prepare: prepareFactual },
        methodId: addressed('hpn-pav-method', 'method'),
        methodAuthority: { loadExact: vi.fn() },
        captureSource,
      }
    );

    await expect(
      preparation.prepare({ requestId: unsupportedRequest.requestId, claim })
    ).rejects.toThrow('HPN preparation does not support aflw:2026-trades.');
    expect(prepareFactual).not.toHaveBeenCalled();
    expect(captureSource).not.toHaveBeenCalled();
  });
});
