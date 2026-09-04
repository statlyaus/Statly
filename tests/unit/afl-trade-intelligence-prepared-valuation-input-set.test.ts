import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION,
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
  createAflTradePreparedValuationInputSet,
} from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePreparedValuationInputSetStore } from '@/server/aflTradeIntelligence/valuation/postgresPreparedValuationInputSetStore';

const digest = (character: string) => character.repeat(64);
type PreparedInput = Parameters<typeof createAflTradePreparedValuationInputSet>[0];

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 256,
    createdAt: '2026-08-15T01:00:00.000Z',
  };
}

function content() {
  return {
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
    environment: 'non_production' as const,
    scopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    preparationAuthority: 'source_policy_preflight_only' as const,
    qualificationOperation: 'valuation_model_training_and_derived_feature_creation' as const,
    qualificationReportId: `valuation-source-qualification:${digest('4')}`,
    qualificationReportArtifact: artifact('5'),
    sourceQualificationEvidenceRefs: [artifact('6'), artifact('8')],
    releaseTradeIds: ['trade-a', 'trade-b'],
    entries: [
      {
        tradeId: 'trade-a',
        state: 'blocked' as const,
        blockers: [
          {
            code: 'source_blocked' as const,
            subject: { kind: 'source' as const, id: 'official-afl-2026' },
            evidenceRefs: [artifact('6')],
          },
        ],
      },
      {
        tradeId: 'trade-b',
        state: 'blocked' as const,
        blockers: [
          {
            code: 'source_blocked' as const,
            subject: { kind: 'source' as const, id: 'afl-tables-five-season' },
            evidenceRefs: [artifact('8')],
          },
        ],
      },
    ],
    tradeCount: 2,
    readyCount: 0,
    blockedCount: 2,
    preparedAt: '2026-08-15T02:00:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.' as const,
  };
}

function v2Content() {
  return {
    ...content(),
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION,
    preparationAuthority: 'authenticated_calculation_evidence_snapshot' as const,
    valuationInputBundleId: `valuation-input-bundle:${digest('9')}`,
    valuationInputBundleArtifact: artifact('a'),
    entries: [
      {
        tradeId: 'trade-a',
        state: 'ready' as const,
        calculationInputPackageId: `valuation-calculation-input:${digest('b')}`,
        calculationInputArtifact: artifact('c'),
        inputTraceId: `private-evaluation-input-trace:${digest('d')}`,
        inputTraceArtifact: artifact('e'),
      },
      {
        tradeId: 'trade-b',
        state: 'blocked' as const,
        blockers: [
          {
            code: 'lineage_unresolved' as const,
            subject: { kind: 'lineage' as const, id: 'asset:pick-12' },
            evidenceRefs: [artifact('f')],
          },
        ],
      },
    ],
    readyCount: 1,
    blockedCount: 1,
  };
}

function v3Content() {
  const blockedEntry = v2Content().entries[1];
  if (blockedEntry?.state !== 'blocked') {
    throw new Error('Expected the second prepared fixture entry to be blocked.');
  }
  return {
    ...v2Content(),
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION,
    entries: [
      {
        tradeId: 'trade-a',
        state: 'ready' as const,
        materializationManifestId: `private-evaluation-materialization-manifest:${digest('7')}`,
        materializationManifestArtifact: artifact('b'),
      },
      blockedEntry,
    ],
  } satisfies Extract<
    PreparedInput,
    {
      schemaVersion: typeof AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION;
      preparationAuthority: 'authenticated_calculation_evidence_snapshot';
    }
  >;
}

describe('AFL trade prepared valuation input set', () => {
  it('keeps current prepared authority behind explicit CAS and coherent read methods', () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore({
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async (work) => work({ query: async () => ({ rows: [], rowCount: 0 }) }),
    });

    expect(store.activateCurrent).toEqual(expect.any(Function));
    expect(store.loadCurrent).toEqual(expect.any(Function));
    expect(store.loadCurrentTrade).toEqual(expect.any(Function));
  });

  it('rejects relational ancestry that disagrees with finalized v3 bytes', async () => {
    const prepared = createAflTradePreparedValuationInputSet(v3Content());
    const preparedContent = prepared.content;
    if (preparedContent.preparationAuthority !== 'authenticated_calculation_evidence_snapshot') {
      throw new Error('Expected authenticated prepared valuation input fixture.');
    }
    let queryIndex = 0;
    const client: AflOutcomeSqlClient = {
      async query<Row>() {
        queryIndex += 1;
        if (queryIndex === 1) {
          return {
            rows: [
              {
                schema_version: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION,
                environment: prepared.content.environment,
                scope_key: prepared.content.scopeKey,
                factual_release_scope_key: prepared.content.factualReleaseScopeKey,
                factual_release_id: prepared.content.factualReleaseId,
                qualification_report_id: preparedContent.qualificationReportId,
                prepared_at: prepared.content.preparedAt,
                prepared_set_json: prepared,
                content_canonical_json: canonicalizeAflTradeJson(prepared.content),
                prepared_set_canonical_json: canonicalizeAflTradeJson(prepared),
                finalized_at: prepared.content.preparedAt,
                trade_count: prepared.content.tradeCount,
                ready_count: prepared.content.readyCount,
                blocked_count: prepared.content.blockedCount,
                actual_count: prepared.content.tradeCount,
                actual_ready_count: prepared.content.readyCount,
                actual_blocked_count: prepared.content.blockedCount,
              },
            ],
            rowCount: 1,
          } as unknown as AflOutcomeSqlQueryResult<Row>;
        }
        return {
          rows: prepared.content.entries.map((entry, index) => ({
            ordinal: index + 1,
            trade_id: entry.tradeId,
            state: entry.state,
            entry_canonical_json: canonicalizeAflTradeJson(entry),
            entry_json: entry,
          })),
          rowCount: prepared.content.entries.length,
        } as unknown as AflOutcomeSqlQueryResult<Row>;
      },
      async transaction(work) {
        return work(this);
      },
    };
    const store = new PostgresAflTradePreparedValuationInputSetStore(client);

    await expect(store.loadExact(prepared.preparedInputSetId)).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    });
  });

  it('classifies every factual-release trade exactly once as blocked preflight evidence', () => {
    const prepared = createAflTradePreparedValuationInputSet(content());

    expect(prepared.preparedInputSetId).toBe(
      createAflTradeContentAddress('prepared-valuation-input-set', prepared.content)
    );
    expect(prepared.content.entries.map(({ state }) => state)).toEqual(['blocked', 'blocked']);
    expect(prepared.content.qualificationOperation).toBe(
      'valuation_model_training_and_derived_feature_creation'
    );
    expect(prepared.content.readyCount + prepared.content.blockedCount).toBe(
      prepared.content.tradeCount
    );
  });

  it('fails closed when a release trade is omitted from classification', () => {
    const incomplete = content();
    incomplete.entries = incomplete.entries.slice(0, 1);
    incomplete.blockedCount = 0;

    expect(() => createAflTradePreparedValuationInputSet(incomplete)).toThrow(
      'Prepared entries must classify the exact factual-release trade set.'
    );
  });

  it('rejects an invented ready value where only blocker evidence exists', () => {
    const inconsistent = {
      ...content(),
      entries: [
        content().entries[0],
        {
          tradeId: 'trade-b',
          state: 'ready',
          calculationInputArtifact: artifact('7'),
          inputTraceArtifact: artifact('8'),
        },
      ],
      readyCount: 1,
      blockedCount: 1,
    } as unknown as PreparedInput;

    expect(() => createAflTradePreparedValuationInputSet(inconsistent)).toThrow(
      'cannot assert model-ready trade inputs'
    );
  });

  it('rejects production use of the local preflight contract', () => {
    expect(() =>
      createAflTradePreparedValuationInputSet({
        ...content(),
        environment: 'production',
      } as unknown as PreparedInput)
    ).toThrow();
  });

  it('rejects model blockers from the source-policy-only v1 contract', () => {
    const invalid = structuredClone(content()) as unknown as {
      entries: { blockers: { code: string }[] }[];
    };
    invalid.entries[0]!.blockers[0]!.code = 'model_not_approved';

    expect(() =>
      createAflTradePreparedValuationInputSet(invalid as unknown as PreparedInput)
    ).toThrow('accepts only exact source-policy blockers');
  });

  it('v2 classifies every release trade as authenticated ready or factual blocked', () => {
    const prepared = createAflTradePreparedValuationInputSet(v2Content());

    expect(prepared.content.schemaVersion).toBe(
      AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V2_SCHEMA_VERSION
    );
    expect(prepared.content.readyCount).toBe(1);
    expect(prepared.content.blockedCount).toBe(1);
    expect(prepared.content.entries[0]).toMatchObject({
      state: 'ready',
      calculationInputPackageId: `valuation-calculation-input:${digest('b')}`,
      inputTraceId: `private-evaluation-input-trace:${digest('d')}`,
    });
  });

  it('v2 rejects a ready entry whose semantic input and trace share retained bytes', () => {
    const input = v2Content();
    const ready = input.entries[0];
    if (ready?.state !== 'ready') throw new Error('Expected ready fixture entry.');
    ready.inputTraceArtifact = ready.calculationInputArtifact;

    expect(() => createAflTradePreparedValuationInputSet(input)).toThrow(
      'Calculation input and trace must be distinct immutable artifacts.'
    );
  });

  it('v3 classifies each trade through one bounded materialization manifest or blocker', () => {
    const prepared = createAflTradePreparedValuationInputSet(v3Content());

    expect(prepared.content.schemaVersion).toBe(
      AFL_TRADE_PREPARED_VALUATION_INPUT_SET_V3_SCHEMA_VERSION
    );
    expect(prepared.content.entries[0]).toEqual({
      tradeId: 'trade-a',
      state: 'ready',
      materializationManifestId: `private-evaluation-materialization-manifest:${digest('7')}`,
      materializationManifestArtifact: artifact('b'),
    });
    expect(prepared.content.readyCount + prepared.content.blockedCount).toBe(
      prepared.content.tradeCount
    );
  });
});
