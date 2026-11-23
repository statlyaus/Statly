import { describe, expect, it } from 'vitest';

import { parseLocalExternalCaptureArguments } from '../../Scripts/capture-local-external-pages';
import { parseSeasonSourceDecisionArguments } from '../../Scripts/record-season-source-decision';
import {
  createDraftguruPostDraftOrderCaptureCommand,
  createLocalDraftguruPostDraftOrderTargets,
  DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
  DRAFTGURU_POST_DRAFT_ORDER_FIELDS,
  draftguruPostDraftOrderDataset,
} from '@/server/aflTradeIntelligence/development/localDraftguruPostDraftOrderCapture';
import { draftguruNationalYearDecisionKey } from '@/server/aflTradeIntelligence/development/localDraftguruNationalYearCapture';
import {
  loadRecordedLocalCaptureAuthority,
  localExternalCaptureDecisionKey,
} from '@/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import { LocalExternalCaptureError } from '@/server/aflTradeIntelligence/development/localNarrowCaptureAuthority';
import { deriveSeasonSourceDecision } from '@/server/aflTradeIntelligence/development/localSeasonSourceDecision';
import { parseDraftguruPostDraftOrder } from '@/server/aflTradeIntelligence/source/draftguruPostDraftOrderAdapter';
import { captureDraftguruSource } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0AAgainstDecision } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import {
  player,
  postDraftOrderPage,
  SEP,
  SYNTHETIC_ORDER_ROWS,
  trade,
} from '../testUtils/draftguruPostDraftOrderPage';
import {
  approveNarrowAuthority,
  draftguruNationalYearAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';

const digest = (character: string) => character.repeat(64);
const URL_2026 = 'https://www.draftguru.com.au/years/2026/provisional-draft-order/post-draft';
const capturedAt = '2026-11-23T01:00:00.000Z';
const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html',
  sourceUrl: URL_2026,
  capturedAt,
  effectiveAt: capturedAt,
  parserVersion: 'draftguru-post-draft-order/v1',
  fieldManifestSha256: digest('3'),
};
const parse = (html: string, overrides: Partial<typeof capture> = {}, draftYear = 2026) =>
  parseDraftguruPostDraftOrder(html, { capture: { ...capture, ...overrides }, draftYear });

const club = (nativeId: string, recordedName: string) => ({ nativeId, recordedName });

describe('Draftguru post-draft order parser (v1)', () => {
  it('reads one claim per row, in page order, for every reviewed row shape', () => {
    const { evidence, issues } = parse(postDraftOrderPage(SYNTHETIC_ORDER_ROWS));
    expect(issues).toEqual([]);
    expect(evidence.map(({ content }) => content.sourceRow)).toEqual(
      SYNTHETIC_ORDER_ROWS.map((_row, index) => ({
        ordinal: index + 1,
        sourceKey: `2026:national:order:${index + 1}`,
      }))
    );
    const claims = evidence.map(({ content }) => content.claim);
    expect(claims[0]).toEqual({
      kind: 'draft_order_pick',
      draftYear: 2026,
      draftType: 'national',
      roundNumber: 1,
      pickNumber: 1,
      club: club('port-adelaide', 'Port Adelaide'),
      origin: {
        kind: 'bid_matched',
        bidClub: club('essendon', 'Essendon'),
        basis: 'next_generation_academy',
        nominee: club('ann_alpha/1', 'Ann Alpha'),
        usingPicks: [6, 22],
      },
      hops: [],
      bidNotMatchedBy: null,
      outcome: { kind: 'selected', player: club('ann_alpha/1', 'Ann Alpha') },
    });
    expect(claims[1]).toMatchObject({
      origin: {
        kind: 'entitlement',
        club: club('essendon', 'Essendon'),
        roundNumber: 1,
        rank: 18,
      },
      hops: [],
    });
    // A trade id keeps the apostrophe the page encodes as &#39;, as the trade index reads it; a
    // player id keeps its %20.
    expect(claims[2]).toMatchObject({
      origin: { kind: 'entitlement', club: club('port-adelaide', 'Port Adelaide'), rank: 15 },
      hops: [{ toClub: club('melbourne', 'Melbourne'), nativeEventId: "2026-cal-o'charlie" }],
      outcome: { kind: 'selected', player: club('dee_van%20delta/1', 'Dee Van Delta') },
    });
    expect(claims[3]).toMatchObject({
      club: club('sydney', 'Sydney'),
      origin: { kind: 'compensation', label: 'Band 1 Free Agency Comp for Eve Echo' },
      hops: [
        {
          toClub: club('greater-western-sydney', 'GWS'),
          nativeEventId: '2026-picks-gold_coast-greater_western_sydney-28',
        },
        {
          toClub: club('sydney', 'Sydney'),
          nativeEventId: '2026-picks-greater_western_sydney-sydney-29',
        },
      ],
      bidNotMatchedBy: club('brisbane', 'Brisbane'),
    });
    expect(claims[4]).toMatchObject({
      origin: {
        kind: 'leftover_points',
        club: club('greater-western-sydney', 'GWS'),
        nominee: club('gus_golf/1', 'Gus Golf'),
      },
      outcome: { kind: 'selected', player: club('hal_hotel/1', 'Hal Hotel') },
    });
    expect(claims[5]).toMatchObject({
      roundNumber: 2,
      origin: { kind: 'compensation', label: 'Bidding compensation awarded after night one' },
    });
    expect(claims[6]).toMatchObject({ roundNumber: 3, pickNumber: 7, origin: null, hops: [] });
    expect(claims[7]).toMatchObject({
      pickNumber: null,
      club: club('port-adelaide', 'Port Adelaide'),
      origin: { kind: 'entitlement', club: club('north-melbourne', 'North Melbourne') },
      outcome: { kind: 'bid_spent', nominee: club('ann_alpha/1', 'Ann Alpha'), asPick: 6 },
    });
    expect(claims[8]).toMatchObject({
      roundNumber: 5,
      pickNumber: null,
      outcome: { kind: 'removed', note: 'not enough list spots' },
    });
  });

  it('never reads the points or games cells', () => {
    const { evidence } = parse(postDraftOrderPage(SYNTHETIC_ORDER_ROWS));
    expect(JSON.stringify(evidence)).not.toMatch(/"(?:points|pointsUsed|games|avgGames|value)"/u);
  });

  it.each([
    [
      'an unknown club abbreviation',
      `<span>Lions R1 pick (1st)</span>${SEP}Picked ${player('a', 'A A')}`,
    ],
    [
      'an unknown hop club',
      `<span>Ess R1 pick (1st)</span>${SEP}To Kan in ${trade('2026-x')}${SEP}Picked ${player('a', 'A A')}`,
    ],
    ['an unreviewed origin', `Priority pick for Essendon${SEP}Picked ${player('a', 'A A')}`],
    ['an unreviewed outcome', `<span>Ess R1 pick (1st)</span>${SEP}Traded away`],
    [
      'a declined bid by an unknown club',
      `Bid not matched by Kangaroos${SEP}Picked ${player('a', 'A A')}`,
    ],
    [
      'two origins',
      `<span>Ess R1 pick (1st)</span>${SEP}<span>Ess R2 pick (1st)</span>${SEP}Picked ${player('a', 'A A')}`,
    ],
    [
      'a hop link outside the trades',
      `<span>Ess R1 pick (1st)</span>${SEP}To Port in <a href="https://example.test/trades/2026-x">swap</a>${SEP}Picked ${player('a', 'A A')}`,
    ],
  ])('refuses the whole page for %s', (_label, origin) => {
    const { evidence, issues } = parse(
      postDraftOrderPage([
        ...SYNTHETIC_ORDER_ROWS,
        { round: 1, pick: 8, club: ['essendon', 'Essendon'], origin },
      ])
    );
    expect(evidence).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'unsupported_row', sourceKey: '2026:national:order:10' }),
    ]);
  });

  it('refuses a chain that does not reach the holder, and a numbered row that is no selection', () => {
    const wrongHolder = parse(
      postDraftOrderPage([
        {
          round: 1,
          pick: 1,
          club: ['carlton', 'Carlton'],
          origin: `<span>Ess R1 pick (1st)</span>${SEP}To Port in ${trade('2026-x')}${SEP}Picked ${player('a', 'A A')}`,
        },
      ])
    );
    const numberedSpend = parse(
      postDraftOrderPage([
        {
          round: 1,
          pick: 1,
          club: ['essendon', 'Essendon'],
          origin: `<span>Ess R1 pick (1st)</span>${SEP}Used to match bid for ${player('a', 'A A')} as pick 1`,
        },
      ])
    );
    for (const result of [wrongHolder, numberedSpend]) {
      expect(result.evidence).toEqual([]);
      expect(result.issues).toHaveLength(1);
    }
  });

  it('refuses a club cell outside the reviewed clubs', () => {
    const { evidence, issues } = parse(
      postDraftOrderPage([
        {
          round: 1,
          pick: 1,
          club: ['brisbane-lions', 'Brisbane Lions'],
          origin: `Picked ${player('a', 'A A')}`,
        },
      ])
    );
    expect(evidence).toEqual([]);
    expect(issues[0]?.code).toBe('unsupported_row');
  });

  it('refuses any season, page or parser other than the reviewed 2026 page', () => {
    const html = postDraftOrderPage(SYNTHETIC_ORDER_ROWS);
    const refused = [
      parse(html, {}, 2025),
      parse(html, { sourceUrl: 'https://www.draftguru.com.au/years/2026' }),
      parse(html, { parserVersion: 'draftguru-post-draft-order/v2' }),
      parse('<table class="general provisional-draft-order"></table>'),
    ];
    for (const result of refused) {
      expect(result.evidence).toEqual([]);
      expect(result.issues[0]?.code).toBe('invalid_page');
    }
  });
});

describe('Draftguru post-draft order capture', () => {
  const evidenceIds = {
    productOwnerAuthorization: `artifact:${digest('a')}`,
    boundedCapturePlan: `artifact:${digest('b')}`,
    publicAccessReview: `artifact:${digest('c')}`,
    fieldBoundaryReview: `artifact:${digest('d')}`,
  };
  // The 2026 national-year decision the owner approved the order page "on the same terms" as.
  const nationalYear = draftguruNationalYearAuthority({
    season: 2026,
    evidenceIds,
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-11-21T00:00:00.000Z',
      proposalProposedAt: '2026-11-21T00:00:01.000Z',
    },
  });
  const predecessor = {
    ...nationalYear,
    decision: approveNarrowAuthority(nationalYear, {
      decidedAt: '2026-11-21T01:00:00.000Z',
      revalidateAt: '2027-05-21T00:00:00.000Z',
    }),
  };
  const derived = deriveSeasonSourceDecision({
    predecessor,
    decisionKey: localExternalCaptureDecisionKey(DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY, 2026),
    season: 2026,
    approvalArtifactId: `artifact:${digest('9')}`,
    decidedAt: '2026-11-23T00:00:00.000Z',
    revalidateAt: '2027-05-23T00:00:00.000Z',
    parserVersion: 'draftguru-post-draft-order/v1',
    capability: {
      from: 'draftguru-national-year-page',
      to: DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
      fields: DRAFTGURU_POST_DRAFT_ORDER_FIELDS,
      dataset: draftguruPostDraftOrderDataset(2026),
    },
  });
  const ledger = { proposals: [derived.proposal], decisions: [derived.decision] };
  const recorded = {
    load: async () => ({ revision: 2, ledger }),
    resolveAuthorization: async () => ({ revision: 2, ledger, sourceRights: derived.sourceRights }),
  };

  it('derives the decision from the national-year page on its terms, for the new capability', () => {
    const before = nationalYear.sourceRights.content;
    const after = derived.sourceRights.content;
    expect(derived.proposal.content.decisionKey).toBe(
      'draftguru-post-draft-order-issue579-private-2026-parser-v1'
    );
    expect(after.acquisition).toEqual({
      ...before.acquisition,
      capabilityId: 'draftguru-post-draft-order',
      clientVersion: 'draftguru-post-draft-order/v1',
    });
    expect(after.dataset).toBe('Draftguru 2026 post-draft national order');
    expect(after.fields.map(({ sourceField }) => sourceField)).toEqual([
      ...DRAFTGURU_POST_DRAFT_ORDER_FIELDS,
    ]);
    expect(after.fields.every(({ uses }) => uses.archive_fact === 'allowed')).toBe(true);
    expect(after.automatedAccess).toEqual(before.automatedAccess);
    expect(after.retention).toEqual(before.retention);
    expect(
      after.conditions.map(({ conditionId, verificationEvidenceIds }) => ({
        conditionId,
        verificationEvidenceIds,
      }))
    ).toEqual(
      before.conditions.map(({ conditionId, verificationEvidenceIds }) => ({
        conditionId,
        verificationEvidenceIds,
      }))
    );
    expect(after.scope.seasonRanges).toEqual([{ from: 2026, to: 2026 }]);
    expect(JSON.stringify(after)).not.toContain('draftguru-national-year-page');
    expect(derived.decision.content.rationale).toContain(
      `${draftguruNationalYearDecisionKey(2026)} authority to 2026 as its own version-1 decision for capability draftguru-post-draft-order`
    );
  });

  it('refuses a capability change the predecessor does not hold', () => {
    expect(() =>
      deriveSeasonSourceDecision({
        predecessor,
        decisionKey: 'x',
        season: 2026,
        approvalArtifactId: `artifact:${digest('9')}`,
        decidedAt: '2026-11-23T00:00:00.000Z',
        revalidateAt: '2027-05-23T00:00:00.000Z',
        capability: {
          from: 'draftguru-trade-detail',
          to: DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
          fields: DRAFTGURU_POST_DRAFT_ORDER_FIELDS,
          dataset: 'x',
        },
      })
    ).toThrow(/predecessor's capability is draftguru-national-year-page/);
  });

  it('is read by the runner, admits the command, and authorizes every emitted leaf', async () => {
    const authority = await loadRecordedLocalCaptureAuthority(
      recorded,
      DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
      2026,
      capturedAt
    );
    expect(authority.decisionId).toBe(derived.decision.decisionId);
    const [target] = createLocalDraftguruPostDraftOrderTargets([2026]);
    expect(target).toEqual({
      capabilityId: 'draftguru-post-draft-order',
      season: 2026,
      sourceUrl: URL_2026,
    });
    const command = createDraftguruPostDraftOrderCaptureCommand(authority.authority, {
      target: target!,
      capturedAt,
      maximumBytes: 1024,
    });
    expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...command.request, sourceUrl: `${URL_2026}/` })
    ).toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...command.request, anchorSeasonYear: 2025 })
    ).toThrow();
    expect(
      evaluateAflTradeGate0AAgainstDecision(
        derived.decision,
        derived.sourceRights,
        command.gateRequest
      )
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    const { evidence, issues } = parse(postDraftOrderPage(SYNTHETIC_ORDER_ROWS), {
      fieldManifestSha256: command.request.fieldManifestSha256,
    });
    expect(issues).toEqual([]);
    const receipt = createAflTradeGate0AReceipt(
      ledger,
      derived.sourceRights,
      command.gateRequest,
      capturedAt
    );
    expect(() =>
      requireAflTradeExternalEvidenceFieldAuthority({
        evidence,
        sourceRights: derived.sourceRights,
        gate0aReceipt: receipt,
      })
    ).not.toThrow();
  });

  it('enumerates the 2026 page only', () => {
    for (const seasons of [[], [2025], [2026, 2026]]) {
      expect(() => createLocalDraftguruPostDraftOrderTargets(seasons)).toThrow(
        LocalExternalCaptureError
      );
    }
  });

  it('takes the capability and season from the command line', () => {
    const env = {
      AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly:secret@127.0.0.1:5432/outcomes',
      AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly private evaluation (contact: owner@example.test)',
    };
    const base = ['--artifact-root', process.cwd(), '--capability', 'draftguru-post-draft-order'];
    expect(parseLocalExternalCaptureArguments([...base, '--season', '2026'], env).targets).toEqual(
      createLocalDraftguruPostDraftOrderTargets([2026])
    );
    expect(() => parseLocalExternalCaptureArguments([...base, '--url', URL_2026], env)).toThrow();
  });

  it('fetches the post-draft order path and no other path below a year', async () => {
    const fetchImpl = (async () =>
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    await expect(
      captureDraftguruSource({ url: URL_2026, validators: null, maximumBytes: 1024, fetchImpl })
    ).resolves.toMatchObject({ status: 'captured', sourceUrl: URL_2026 });
    await expect(
      captureDraftguruSource({
        url: 'https://www.draftguru.com.au/years/2026/provisional-draft-order/final-before-draft',
        validators: null,
        maximumBytes: 1024,
        fetchImpl,
      })
    ).rejects.toThrow(/outside the approved bounded paths/);
  });

  it('reads --from-capability only for a capability that may be derived from another', () => {
    const env = {
      AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly:secret@127.0.0.1:5432/outcomes',
    };
    const args = (capability: string, extra: string[] = []) => [
      '--capability',
      capability,
      '--season',
      '2026',
      '--from-season',
      '2026',
      '--approval-artifact',
      `artifact:${digest('9')}`,
      '--decided-at',
      '2026-11-23T00:00:00.000Z',
      '--revalidate-at',
      '2027-05-23T00:00:00.000Z',
      '--parser-version',
      'draftguru-post-draft-order/v1',
      ...extra,
    ];
    expect(
      parseSeasonSourceDecisionArguments(
        args('draftguru-post-draft-order', [
          '--from-capability',
          'draftguru-national-year-page',
          '--apply',
        ]),
        env
      )
    ).toMatchObject({
      capabilityId: 'draftguru-post-draft-order',
      fromCapabilityId: 'draftguru-national-year-page',
      season: 2026,
      fromSeason: 2026,
      parserVersion: 'draftguru-post-draft-order/v1',
      apply: true,
    });
    expect(
      parseSeasonSourceDecisionArguments(args('draftguru-post-draft-order'), env)
    ).not.toHaveProperty('fromCapabilityId');
    for (const bad of [
      args('draftguru-trade-detail', ['--from-capability', 'draftguru-national-year-page']),
      args('draftguru-post-draft-order', ['--from-capability', 'draftguru-post-draft-order']),
      args('draftguru-post-draft-order', ['--season', '2026']),
      args('draftguru-post-draft-order', ['--from-capability', 'unknown-capability']),
    ]) {
      expect(() => parseSeasonSourceDecisionArguments(bad, env)).toThrow(TypeError);
    }
  });
});
