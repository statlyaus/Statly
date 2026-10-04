import { describe, expect, it } from 'vitest';

import { parseDraftguruTradeDetail } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
import type { AflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';

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
  seasons: [
    2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
  ],
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
    expect(proposal.content.scope.exclusions.join(' ')).toMatch(
      /Model training, predictive features/
    );
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

  it.each([
    [2012, 'M1'],
    [2013, 'CMP1 (Gold Coast)'],
  ])(
    'authorizes every field the real parser emits for a %i special-pick trade page',
    (year, label) => {
      const empty = '<td colspan="5"></td>';
      const side = `<td class="future-pick-name actual-asset">${label}</td><td colspan="4"></td>`;
      const pick = '<td class="pick-name actual-asset">Pick 10</td><td colspan="4"></td>';
      const html = `<h2 class="heading">Special pick trade</h2><table class="individual-trade"><tr class="club-header"><td>Club A</td></tr><tr class="movement">${side}${empty}</tr><tr class="movement">${pick}${empty}</tr><tr class="club-header"><td>Club B</td></tr><tr class="movement">${empty}${side}</tr><tr class="movement">${empty}${pick}</tr></table>`;
      const at = '2026-09-24T00:00:00.000Z';
      const parsed = parseDraftguruTradeDetail(html, {
        capture: {
          captureId: `source-capture:${digest('5')}`,
          artifactId: `artifact:${digest('6')}`,
          contentSha256: digest('6'),
          mediaType: 'text/html',
          sourceUrl: `https://www.draftguru.com.au/trades/${year}-special-pick`,
          capturedAt: at,
          effectiveAt: at,
          parserVersion: 'draftguru-trade-parser/v1',
          fieldManifestSha256: digest('7'),
        },
        draftYear: year,
        effectiveAt: at,
      });
      expect(parsed.issues).toEqual([]);
      expect(
        parsed.evidence.some(
          ({ content }) =>
            content.claim.kind === 'directed_transfer' &&
            content.claim.asset.kind === 'special_pick'
        )
      ).toBe(true);

      const { sourceRights } = createDraftguruTradeAuthorityProposal(input());
      const gate0aReceipt = {
        content: {
          request: {
            fieldUses: sourceRights.content.fields.map(({ sourceField }) => ({
              sourceField,
              use: 'archive_fact',
            })),
          },
        },
      } as unknown as AflTradeGate0AReceipt;

      expect(() =>
        requireAflTradeExternalEvidenceFieldAuthority({
          evidence: parsed.evidence,
          sourceRights,
          gate0aReceipt,
        })
      ).not.toThrow();
    }
  );
});
