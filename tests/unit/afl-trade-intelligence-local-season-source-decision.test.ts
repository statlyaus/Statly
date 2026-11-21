import { describe, expect, it } from 'vitest';

import {
  createDraftguruTradeAuthorityProposal,
  draftguruTradeDecisionKey,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  citedGateArtifactIds,
  deriveSeasonSourceDecision,
  predecessorSeasonTraces,
} from '@/server/aflTradeIntelligence/development/localSeasonSourceDecision';
import { validateAflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import { DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { approveNarrowAuthority } from '../testUtils/localNarrowCaptureAuthorityFixture';

const digest = (character: string) => character.repeat(64);
const approvalArtifactId = `artifact:${digest('9')}`;

function predecessor() {
  const authority = createDraftguruTradeAuthorityProposal({
    capabilityId: 'draftguru-trade-detail',
    parserVersion: DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION,
    seasons: Array.from({ length: 15 }, (_, index) => 2011 + index),
    evidenceIds: {
      productOwnerAuthorization: `artifact:${digest('1')}`,
      boundedCapturePlan: `artifact:${digest('2')}`,
      publicAccessReview: `artifact:${digest('3')}`,
      fieldBoundaryReview: `artifact:${digest('4')}`,
    },
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-09-24T00:00:00.000Z',
      proposalProposedAt: '2026-09-24T00:00:01.000Z',
    },
  });
  const decision = approveNarrowAuthority(authority, {
    decidedAt: '2026-09-25T00:00:00.000Z',
    revalidateAt: '2027-03-25T00:00:00.000Z',
  });
  return { ...authority, decision };
}

const derive = (overrides: { season?: number } = {}) => {
  const season = overrides.season ?? 2026;
  return deriveSeasonSourceDecision({
    predecessor: predecessor(),
    decisionKey: draftguruTradeDecisionKey('draftguru-trade-detail', season),
    season,
    approvalArtifactId,
    decidedAt: '2026-11-21T00:00:00.000Z',
    revalidateAt: '2027-05-21T00:00:00.000Z',
  });
};

describe('deriveSeasonSourceDecision', () => {
  it('derives a version-1 decision on the season key that extends the ledger without a successor', () => {
    const before = predecessor();
    const { sourceRights, proposal, decision } = derive();

    expect(proposal.content.decisionKey).toBe(
      'draftguru-trade-detail-issue-579-private-non_production-parser-v3-2026'
    );
    expect(proposal.content.scope.scopeKey).toBe(proposal.content.decisionKey);
    expect(proposal.content.version).toBe(1);
    expect(decision.content.supersedesDecisionId).toBeNull();
    expect(sourceRights.content.scope.seasonRanges).toEqual([{ from: 2026, to: 2026 }]);
    expect(sourceRights.content.acquisition).toEqual(before.sourceRights.content.acquisition);
    expect(sourceRights.content.automatedAccess).toEqual(
      before.sourceRights.content.automatedAccess
    );
    expect(
      validateAflTradeGateDecisionLedger({
        proposals: [before.proposal, proposal],
        decisions: [before.decision, decision],
      })
    ).toEqual({ valid: true, issues: [] });
  });

  it('leaves no predecessor year or rights id in the proposal', () => {
    const before = predecessor();
    const { sourceRights, proposal } = derive();
    const dimension = (name: string) =>
      proposal.content.scope.dimensions.find((entry) => entry.name === name)?.values;

    expect(dimension('season')).toEqual(['2026']);
    expect(dimension('source_rights_artifact')).toEqual([sourceRights.rightsArtifactId]);
    expect(proposal.content.scope.description).toContain('2026');
    expect(proposal.content.scope.exclusions.join(' ')).not.toMatch(/20(1\d|2[0-5])/u);
    expect(predecessorSeasonTraces(proposal, { from: 2011, to: 2025 }, 2026)).toEqual([]);
    expect(JSON.stringify(proposal)).not.toContain(before.sourceRights.rightsArtifactId);
    expect(sourceRights.content.conditions[0]?.description).toContain('2026 trade pages');
  });

  it('cites the owner approval and carries the predecessor condition evidence', () => {
    const { proposal, decision } = derive();

    expect(decision.content.authorityEvidenceIds).toEqual([approvalArtifactId]);
    expect(decision.content.conditionResults.map(({ evidenceIds }) => evidenceIds)).toEqual([
      [`artifact:${digest('2')}`],
      [`artifact:${digest('1')}`],
    ]);
    expect(citedGateArtifactIds(proposal, decision)).toEqual([
      `artifact:${digest('1')}`,
      `artifact:${digest('2')}`,
      `artifact:${digest('3')}`,
      `artifact:${digest('4')}`,
      approvalArtifactId,
    ]);
  });

  it('refuses rights that still name a predecessor sub-range', () => {
    const base = predecessor();
    const withSubRange = {
      ...base,
      sourceRights: {
        ...base.sourceRights,
        content: {
          ...base.sourceRights.content,
          intendedPurpose: `${base.sourceRights.content.intendedPurpose} Pages 2011-2015 were reviewed first.`,
        },
      },
    };
    expect(() =>
      deriveSeasonSourceDecision({
        predecessor: withSubRange,
        decisionKey: draftguruTradeDecisionKey('draftguru-trade-detail', 2026),
        season: 2026,
        approvalArtifactId,
        decidedAt: '2026-11-21T00:00:00.000Z',
        revalidateAt: '2027-05-21T00:00:00.000Z',
      })
    ).toThrow(/source rights still name predecessor years 2011, 2015/);
  });

  it('refuses a season the predecessor already covers', () => {
    expect(() => derive({ season: 2020 })).toThrow('already covers 2020');
  });
});
