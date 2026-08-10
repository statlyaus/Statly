import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePackagePolicy } from '@/server/aflTradeIntelligence/valuation/packagePolicy';
import { createAflTradeRealizedContributionLedger } from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  aflTradeStructuredExplanationSchema,
  renderAflTradeStructuredExplanationStatement,
} from '@/server/aflTradeIntelligence/valuation/structuredExplanations';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';
import {
  AFL_TRADE_VALUATION_EXTERNAL_BLOCKERS,
  validateAflTradeValuationArtifactChain,
  type AflTradeValuationArtifactChain,
} from '@/server/aflTradeIntelligence/valuation/tradeValuationValidation';
import { createAflTradeValuationCase } from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import {
  aflTradeValuationSnapshotSchema,
  aflTradeValuationSnapshotSetSchema,
} from '@/server/aflTradeIntelligence/valuation/valuationSnapshots';

function chain(kind: Parameters<typeof createFabricatedAflTradeValuationFixture>[0]) {
  const fixture = createFabricatedAflTradeValuationFixture(kind);
  return {
    valuationCase: fixture.valuationCase,
    lineageGraph: fixture.lineageGraph,
    componentDrawSet: fixture.componentDrawSet,
    realizedContributionLedger: fixture.realizedContributionLedger,
    packagePolicy: fixture.packagePolicy,
    calculation: fixture.calculation,
    snapshotSet: fixture.snapshotSet,
    explanation: fixture.explanation,
  } satisfies AflTradeValuationArtifactChain;
}

describe('AFL trade valuation artifact-chain validation', () => {
  it('passes every structural check while preserving external release blockers', () => {
    const report = validateAflTradeValuationArtifactChain(chain('on_traded_pick_return'));

    expect(report.structurallyValid).toBe(true);
    expect(report.publicationReady).toBe(false);
    expect(report.issues).toEqual([]);
    expect(report.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(report.externalBlockers).toEqual(AFL_TRADE_VALUATION_EXTERNAL_BLOCKERS);
  });

  it('fails closed on stale content addresses without throwing', () => {
    const candidate = chain('two_party_player_swap');
    candidate.calculation = {
      ...candidate.calculation,
      content: { ...candidate.calculation.content, valueUnitId: 'tampered-unit' },
    } as typeof candidate.calculation;

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('invalid_artifact_schema');
    expect(report.publicationReady).toBe(false);
  });

  it('detects a validly re-addressed policy and case that no longer match derived outputs', () => {
    const candidate = chain('two_party_player_swap');
    const changedPolicyContent = structuredClone(candidate.packagePolicy.content);
    changedPolicyContent.universalValueLayers.listSpot.overflowRetentionTiers[0].retentionRate = 0.1;
    candidate.packagePolicy = createAflTradePackagePolicy(changedPolicyContent);
    candidate.valuationCase = createAflTradeValuationCase({
      ...candidate.valuationCase.content,
      packagePolicyId: candidate.packagePolicy.packagePolicyId,
    });

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['calculation_replay_mismatch', 'snapshot_replay_mismatch'])
    );
  });

  it('detects lineage removal and descendant contribution breakage', () => {
    const candidate = chain('on_traded_pick_return');
    candidate.lineageGraph = {
      ...candidate.lineageGraph,
      edges: candidate.lineageGraph.edges.slice(1),
    };

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'lineage_graph_id_mismatch',
        'invalid_case_lineage',
        'invalid_realized_attribution',
      ])
    );
  });

  it('detects a validly re-addressed realized ledger that was not recalculated downstream', () => {
    const candidate = chain('future_pick_resolution');
    const changedLedgerContent = structuredClone(candidate.realizedContributionLedger.content);
    const firstRecord = changedLedgerContent.records[0];
    if (firstRecord.state !== 'observed') throw new Error('Expected observed fixture record.');
    firstRecord.contribution += 10;
    candidate.realizedContributionLedger =
      createAflTradeRealizedContributionLedger(changedLedgerContent);
    candidate.valuationCase = createAflTradeValuationCase({
      ...candidate.valuationCase.content,
      realizedContributionLedgerId:
        candidate.realizedContributionLedger.realizedContributionLedgerId,
    });

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('calculation_replay_mismatch');
  });

  it('detects validly re-addressed snapshot statistics that do not replay', () => {
    const candidate = chain('two_party_player_swap');
    const snapshotSetContent = structuredClone(candidate.snapshotSet.content);
    const snapshot = snapshotSetContent.snapshots[0];
    const distribution = snapshot.content.parties[0].universal[0].distribution;
    if (distribution.status !== 'available') throw new Error('Expected available distribution.');
    distribution.statistics.mean += 1;
    snapshot.valuationSnapshotId = createAflTradeContentAddress(
      'valuation-snapshot',
      snapshot.content
    );
    snapshotSetContent.snapshots[0] = aflTradeValuationSnapshotSchema.parse(snapshot);
    candidate.snapshotSet = aflTradeValuationSnapshotSetSchema.parse({
      valuationSnapshotSetId: createAflTradeContentAddress(
        'valuation-snapshot-set',
        snapshotSetContent
      ),
      content: snapshotSetContent,
    });

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('snapshot_replay_mismatch');
  });

  it('detects re-rendered and re-addressed explanation numbers that lose source parity', () => {
    const candidate = chain('two_party_player_swap');
    const explanationContent = structuredClone(candidate.explanation.content);
    const statement = explanationContent.statements.find(
      (item) => item.template === 'distribution_summary'
    );
    if (!statement || statement.template !== 'distribution_summary') {
      throw new Error('Expected distribution statement.');
    }
    statement.mean += 1;
    const { renderedText: _oldText, ...source } = statement;
    statement.renderedText = renderAflTradeStructuredExplanationStatement(source);
    candidate.explanation = aflTradeStructuredExplanationSchema.parse({
      structuredExplanationId: createAflTradeContentAddress(
        'structured-explanation',
        explanationContent
      ),
      content: explanationContent,
    });

    const report = validateAflTradeValuationArtifactChain(candidate);

    expect(report.structurallyValid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['explanation_replay_mismatch', 'explanation_parity_mismatch'])
    );
  });

  it.each(['userId', 'fantasyTeamId', 'ownerId', 'legacyExpectedValue'])(
    'detects forbidden nested field %s independently of schema validation',
    (field) => {
      const candidate = chain('two_party_player_swap') as unknown as Record<string, unknown>;
      const calculation = candidate.calculation as { content: Record<string, unknown> };
      calculation.content[field] = 'forbidden';

      const report = validateAflTradeValuationArtifactChain(
        candidate as unknown as AflTradeValuationArtifactChain
      );

      expect(report.structurallyValid).toBe(false);
      expect(report.issues.map((issue) => issue.code)).toContain(
        'forbidden_ownership_or_legacy_value_field'
      );
    }
  );
});
