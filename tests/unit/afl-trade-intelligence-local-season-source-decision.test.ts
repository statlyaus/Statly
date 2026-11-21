import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';

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
import { draftguruNationalYearDecisionKey } from '@/server/aflTradeIntelligence/development/localDraftguruNationalYearCapture';
import {
  approveNarrowAuthority,
  draftguruNationalYearAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';

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

describe('deriveSeasonSourceDecision with a parser change', () => {
  const V3 = 'draftguru-national-year-page/v3';
  const V8 = 'draftguru-national-year-page/v8';
  // A 2019 year-page decision worded like the recorded one: the parser named in full and as `parser v3`.
  function yearPagePredecessor(clientVersion = V3) {
    const authority = draftguruNationalYearAuthority({
      season: 2019,
      clientVersion,
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
    const content = {
      ...authority.proposal.content,
      scope: {
        ...authority.proposal.content.scope,
        description: 'Exact private 2019 national draft source review at parser v3.',
      },
      proposal: `Approve the 2019 scope at parser ${V3}; Parser v3 reads the club-qualified forms, not parser v30 or parser v3.1.`,
    };
    const proposal = {
      proposalId: createAflTradeContentAddress('gate-proposal', content),
      content,
    };
    return {
      ...authority,
      proposal,
      decision: approveNarrowAuthority(
        { ...authority, proposal },
        { decidedAt: '2026-09-25T00:00:00.000Z', revalidateAt: '2027-03-25T00:00:00.000Z' }
      ),
    };
  }
  const deriveYearPage = (predecessorRecords = yearPagePredecessor(), parserVersion = V8) =>
    deriveSeasonSourceDecision({
      predecessor: predecessorRecords,
      decisionKey: draftguruNationalYearDecisionKey(2026),
      season: 2026,
      approvalArtifactId,
      decidedAt: '2026-11-21T00:00:00.000Z',
      revalidateAt: '2027-05-21T00:00:00.000Z',
      parserVersion,
    });

  it('records the new parser in the rights and rewrites it in the proposal', () => {
    const before = yearPagePredecessor();
    const { sourceRights, proposal, decision } = deriveYearPage(before);

    expect(proposal.content.decisionKey).toBe(
      'draftguru-national-year-page-issue579-private-2026-parser-v8'
    );
    expect(sourceRights.content.acquisition).toEqual({
      ...before.sourceRights.content.acquisition,
      clientVersion: V8,
    });
    expect(proposal.content.scope.description).toBe(
      'Exact private 2026 national draft source review at parser v8.'
    );
    expect(proposal.content.proposal).toBe(
      `Approve the 2026 scope at parser ${V8}; Parser v8 reads the club-qualified forms, not parser v30 or parser v3.1.`
    );
    expect(JSON.stringify(sourceRights.content)).not.toContain(V3);
    // The register id is the reviewed terms' id and stays as recorded.
    expect(sourceRights.content.registerId).toBe(before.sourceRights.content.registerId);
    expect(decision.content.rationale).toContain(`at parser ${V8} (the predecessor's was ${V3})`);
  });

  it('keeps the predecessor parser when the runner reads the same one', () => {
    const before = yearPagePredecessor(V8);
    const { sourceRights, decision } = deriveYearPage(before);
    expect(sourceRights.content.acquisition).toEqual(before.sourceRights.content.acquisition);
    expect(decision.content.rationale).not.toContain('at parser');
  });

  it('refuses to replace a parser that is not a versioned name', () => {
    expect(() => deriveYearPage(yearPagePredecessor('Statly client 1'))).toThrow(
      /Only a <name>\/v<n> parser can be replaced/
    );
  });
});
