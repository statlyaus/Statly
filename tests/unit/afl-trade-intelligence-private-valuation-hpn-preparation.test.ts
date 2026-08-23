import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { createAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/privateValuationFactualOutput';
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
  constructor(private readonly retainedRequest = request) {}

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.startsWith('SET LOCAL ROLE')) return this.result([]);
    if (sql.includes('load_outcome_private_valuation_dispatch_request_for_claim')) {
      return this.result([{ request_json: this.retainedRequest }]);
    }
    if (sql.includes('heartbeat_outcome_private_valuation_dispatch')) {
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

describe('private valuation HPN preparation', () => {
  it('composes three exact capture lanes into the existing HPN input and calculation owners', async () => {
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
        fieldMapId: 'afl-tables-results-local-2026-v1',
        rightsArtifactId:
          createLocalAflTradeAflTablesResultsAuthority(2026).capture.sourceRights.rightsArtifactId,
      },
      hpn_primary_player_stats: {
        provider: 'afl_tables',
        dataset: 'AFL Tables historical player match statistics',
        capabilityId: 'afl-tables-player-stats',
        fieldMapId: 'afl-tables-player-stats-local-2026-v1',
        rightsArtifactId:
          createLocalAflTradeFiveSeasonAflTablesAuthority(2026).capture.sourceRights.rightsArtifactId,
      },
      hpn_corroborating_player_stats: {
        provider: 'official_afl',
        dataset: 'Official AFL 2026 player match statistics',
        capabilityId: 'official-afl-player-stats',
        fieldMapId: 'official-afl-player-stats-local-2026-v1',
        rightsArtifactId:
          createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights.rightsArtifactId,
      },
    } as const;
    const retainedBindings = new Map<string, Awaited<ReturnType<
      PostgresAflTradePrivateValuationCaptureBindingRepository['accept']
    >>>();
    const loadBinding = vi
      .spyOn(PostgresAflTradePrivateValuationCaptureBindingRepository.prototype, 'load')
      .mockImplementation(async (_request, sourceRole = 'factual_input') =>
        retainedBindings.get(sourceRole) ?? null
      );
    const acceptBinding = vi
      .spyOn(PostgresAflTradePrivateValuationCaptureBindingRepository.prototype, 'accept')
      .mockImplementation(async ({ sourceRole, normalizationRunId }) => {
        const exactRole = sourceRole as (typeof roles)[number];
        const sourcePlan = sourcePlanByRole[exactRole];
        const content = {
          schemaVersion: 'afl-trade-private-valuation-capture-binding/v2' as const,
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
          bindingId: createAflTradeContentAddress(
            'private-valuation-capture-binding',
            content
          ),
          content,
        };
        retainedBindings.set(exactRole, binding);
        return binding;
      });
    const selectedMaps = vi
      .spyOn(PostgresAflTradeHpnProjectedFieldMapAuthority.prototype, 'loadCurrentForSource')
      .mockImplementation(async ({ inputKind, provider }) => ({
        fieldMapId: addressed('hpn-pav-field-map', `${provider}:${inputKind}`),
      }) as never);
    const buildInput = vi
      .spyOn(PostgresAflTradeHpnPavInputRepository.prototype, 'buildAndPersistSeasonInputSet')
      .mockResolvedValue({
        inputSet: { inputSetId: addressed('hpn-pav-input-set', 'input') } as never,
        idempotentReplay: false,
      });
    const calculate = vi
      .spyOn(PostgresAflTradeHpnPavCalculationRepository.prototype, 'calculateAndPersist')
      .mockResolvedValue({
        calculation: { calculationId: addressed('hpn-pav-season', 'calculation') } as never,
        idempotentReplay: false,
      });
    const captureSource = vi.fn(async ({ sourceRole }: { sourceRole: string }) => ({
      normalizationRunId: addressed('provider-normalization-run', sourceRole),
    }));
    const prepareFactual = vi
      .fn()
      .mockResolvedValueOnce({ state: 'prepared' as const, output: factualOutput() })
      .mockResolvedValue({ state: 'already_prepared' as const, output: factualOutput() });
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(
      new PreparationSqlClient(),
      {
        factualPreparation: { prepare: prepareFactual },
        methodId: addressed('hpn-pav-method', 'method'),
        methodAuthority: { loadExact: vi.fn() },
        captureSource,
      }
    );

    await expect(preparation.prepare({ requestId: request.requestId, claim })).resolves.toEqual({
      state: 'prepared',
      requestId: request.requestId,
      factualOutputId: factualOutput().outputId,
      inputSetId: addressed('hpn-pav-input-set', 'input'),
      calculationId: addressed('hpn-pav-season', 'calculation'),
      captureBindingIds: roles.map((_role) =>
        expect.stringMatching(/^private-valuation-capture-binding:[a-f0-9]{64}$/u)
      ),
      publicationEligible: false,
    });
    expect(loadBinding).toHaveBeenCalledTimes(3);
    expect(acceptBinding).toHaveBeenCalledTimes(3);
    expect(captureSource.mock.calls.map(([input]) => input.sourceRole)).toEqual(roles);
    expect(selectedMaps).toHaveBeenCalledTimes(3);
    expect(buildInput).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'non_production',
        competition: 'AFLM',
        seasonYear: 2026,
        factualRunId: factualOutput().content.reconciliation.factualRunId,
        sources: expect.arrayContaining([
          expect.objectContaining({ inputKind: 'completed_match_result', role: null }),
          expect.objectContaining({ inputKind: 'player_match_stats', role: 'primary' }),
          expect.objectContaining({ inputKind: 'player_match_stats', role: 'corroborating' }),
        ]),
      }),
      { environment: 'non_production' }
    );
    expect(calculate).toHaveBeenCalledTimes(1);

    buildInput.mockResolvedValue({
      inputSet: { inputSetId: addressed('hpn-pav-input-set', 'input') } as never,
      idempotentReplay: true,
    });
    calculate.mockResolvedValue({
      calculation: { calculationId: addressed('hpn-pav-season', 'calculation') } as never,
      idempotentReplay: true,
    });
    await expect(preparation.prepare({ requestId: request.requestId, claim })).resolves.toMatchObject({
      state: 'already_prepared',
      inputSetId: addressed('hpn-pav-input-set', 'input'),
      calculationId: addressed('hpn-pav-season', 'calculation'),
    });
    expect(captureSource).toHaveBeenCalledTimes(3);
    expect(acceptBinding).toHaveBeenCalledTimes(3);
  });

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
    ).rejects.toThrow(/supports only afl-men:2026-trades/i);
    expect(prepareFactual).not.toHaveBeenCalled();
    expect(captureSource).not.toHaveBeenCalled();
  });
});
