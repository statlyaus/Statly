import { describe, expect, it } from 'vitest';

import {
  createDraftguruTradeAuthorityProposal,
  DRAFTGURU_TRADE_DETAIL_FIELDS,
  DRAFTGURU_TRADE_INDEX_FIELDS,
  DRAFTGURU_TRADE_PERMITTED_OPERATIONS,
  type DraftguruTradeAuthorityProposalInput,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';

const digest = (character: string) => character.repeat(64);

const input = (
  overrides: Partial<DraftguruTradeAuthorityProposalInput> = {}
): DraftguruTradeAuthorityProposalInput => ({
  capabilityId: 'draftguru-trade-detail',
  // Only the seasons the cohort actually needs, per the measured relevance span.
  seasons: [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
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
  ...overrides,
});

const operationDimension = (
  proposal: ReturnType<typeof createDraftguruTradeAuthorityProposal>['proposal']
) => proposal.content.scope.dimensions.find(({ name }) => name === 'operation')!.values;

describe('createDraftguruTradeAuthorityProposal', () => {
  it('permits only the internal operations and records the excluded uses as blocked', () => {
    const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal(input());

    expect(operationDimension(proposal)).toEqual([...DRAFTGURU_TRADE_PERMITTED_OPERATIONS]);
    for (const excluded of [
      'model_training',
      'derived_feature_creation',
      'public_derived_output',
      'public_fact_display',
      'raw_field_redistribution',
    ] as const) {
      expect(sourceRights.content.operations[excluded]).toBe('blocked');
    }
  });

  it('keeps the record internal-only, matching the owner decision rather than the broader factory', () => {
    const { proposal } = createDraftguruTradeAuthorityProposal(input());
    const dimension = (name: string) =>
      proposal.content.scope.dimensions.find((entry) => entry.name === name)!.values;

    expect(dimension('commercial_context')).toEqual(['internal-evaluation']);
    expect(dimension('audience')).toEqual(['internal']);
    expect(dimension('access_mechanism')).toEqual(['automated_web']);
    expect(proposal.content.reviewRequirement).toBe('accountable_owner_only');
    expect(proposal.content.requiredReviewerRoles).toEqual([]);
    // The broader internal factories ask for an independent review this decision does not require.
    expect(proposal.content.reviewRequirement).not.toBe('independent_review_required');
  });

  it('states the retained five-second pacing, not the broader three-second rate', () => {
    const { sourceRights } = createDraftguruTradeAuthorityProposal(input());

    expect(sourceRights.content.automatedAccess.rateLimit).toEqual({
      requests: 1,
      perSeconds: 5,
      burst: 1,
    });
  });

  it('records every field as an archive fact and blocks training and derived use per field', () => {
    const { sourceRights } = createDraftguruTradeAuthorityProposal(input());

    expect(sourceRights.content.fields.map(({ sourceField }) => sourceField)).toEqual([
      ...DRAFTGURU_TRADE_DETAIL_FIELDS,
    ]);
    for (const field of sourceRights.content.fields) {
      expect(field.uses).toEqual({
        archive_fact: 'allowed',
        model_training: 'blocked',
        derived_feature: 'blocked',
        public_display: 'blocked',
      });
    }
  });

  it('scopes to the cohort seasons and names the exclusions in the Gate proposal', () => {
    const { proposal } = createDraftguruTradeAuthorityProposal(input());
    const seasons = proposal.content.scope.dimensions.find(({ name }) => name === 'season')!.values;

    expect(seasons.at(0)).toBe('2011');
    expect(seasons.at(-1)).toBe('2025');
    expect(seasons).toHaveLength(15);
    expect(proposal.content.scope.exclusions.join(' ')).toMatch(/Model training, predictive features/);
    expect(proposal.content.scope.exclusions.join(' ')).toMatch(/fantasy use/);
    expect(proposal.content.environment).toBe('non_production');
  });

  it('uses the index field set for the index capability', () => {
    const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal(
      input({ capabilityId: 'draftguru-trade-index' })
    );

    expect(sourceRights.content.fields.map(({ sourceField }) => sourceField)).toEqual([
      ...DRAFTGURU_TRADE_INDEX_FIELDS,
    ]);
    expect(proposal.content.decisionKey).toBe(
      'draftguru-trade-index-issue-579-private-non_production'
    );
  });

  it('states machine provenance rather than claiming human authorship', () => {
    const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal(input());

    expect(sourceRights.content.proposalOrigin).toBe('agent_assisted');
    expect(proposal.content.proposalOrigin).toBe('agent_assisted');
    expect(sourceRights.content.proposedBy).not.toBe('statly-product-owner');
  });

  it('refuses a non-contiguous season set rather than silently widening the scope', () => {
    expect(() => createDraftguruTradeAuthorityProposal(input({ seasons: [2011, 2025] }))).toThrow(
      /contiguous/
    );
    expect(() => createDraftguruTradeAuthorityProposal(input({ seasons: [] }))).toThrow(
      /at least one season/
    );
  });
});
