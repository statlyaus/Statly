import { describe, expect, it } from 'vitest';

import {
  DRAFTGURU_TRADE_EVENTUAL_SELECTION_FIELDS,
  DRAFTGURU_TRADE_DETAIL_V2_FIELDS,
  DRAFTGURU_TRADE_DETAIL_V3_FIELDS,
  createDraftguruTradeAuthorityProposal,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION,
  DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION,
  parseDraftguruTradeDetail,
} from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';

const digest = (character: string) => character.repeat(64);
const capture = (sourceUrl: string, parserVersion: string) => ({
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl,
  capturedAt: '2026-10-12T01:00:00.000Z',
  effectiveAt: '2026-10-12T01:00:00.000Z',
  parserVersion,
  fieldManifestSha256: digest('3'),
});

// Row markup as Draftguru serves it (2024-picks-port_adelaide-west_coast-21 and the 2024 Atkins
// trade, read 2026-10-12): five cells per side; a pick row names the player selected with the pick,
// or states that it was traded on or not used.
const empty = '<td></td><td></td><td></td><td></td><td class="last-in-section"></td>';
const used = (label: string, slug: string, name: string) =>
  `<td class="${label.startsWith('Pick') ? 'pick-name' : 'future-pick-name'} actual-asset expected-value-ok">${label}</td><td class="player-name expected-value-ok"><a href="/players/${slug}">${name.replace(' ', '&nbsp;')}</a></td><td class="player-games expected-value-ok">25 games</td><td class="pick-points expected-value-ok">1067 points</td><td class="expected-value expected-value-ok last-in-section"><a href="/analysis/expected-games/picks/16">70 XG</a></td>`;
const stated = (label: string, text: string, future = false) =>
  `<td class="${future ? 'future-pick-name' : 'pick-name'} actual-asset">${label}${future ? '<br/><span class="pick-estimation">(estimate: pick 16)</span>' : ''}</td><td class="pick-description" colspan="2">${text}</td><td class="pick-points">273 points</td><td class="expected-value last-in-section">22 XG</td>`;
const row = (gave: string, got: string) => `<tr class="movement">${gave}${got}</tr>`;
const club = (name: string) =>
  `<tr class="club-header"><td colspan="10">${name}</td></tr><tr class="club-subheader"><td colspan="5">What ${name} Gave</td><td colspan="5">What ${name} Got</td></tr>`;
const table = (title: string, rows: string) =>
  `<h2 class="heading">${title}</h2><table class="individual-trade">${rows}</table>`;

// Draft night 2024: West Coast's pick 15 for Port Adelaide's 16 and 45.
const draftNight = table(
  '2024 Port Adelaide and West Coast Trade for Draft Picks',
  club('Port Adelaide') +
    row(empty, used('Pick 15', 'joe_berry/1', 'Joe Berry')) +
    row(used('Pick 16', 'bo_allan/1', 'Bo Allan'), empty) +
    row(used('Pick 45', 'tom_gross/1', 'Tom Gross'), empty) +
    club('West Coast') +
    row(used('Pick 15', 'joe_berry/1', 'Joe Berry'), empty) +
    row(empty, used('Pick 16', 'bo_allan/1', 'Bo Allan')) +
    row(empty, used('Pick 45', 'tom_gross/1', 'Tom Gross'))
);
// Trade period 2024: Gold Coast's pick 13 (traded on), Port's future first (traded on, then used
// on Xavier Taylor) and a pick nobody used.
const tradePeriod = table(
  '2024 Gold Coast and Port Adelaide Trade',
  club('Gold Coast') +
    row(used('Pick 13', 'bo_allan/1', 'Bo Allan'), empty) +
    row(empty, stated('2025R1 (Port Adelaide)', 'Pick traded on to another club', true)) +
    row(empty, stated('Pick 39', 'Pick not used')) +
    club('Port Adelaide') +
    row(empty, stated('Pick 13', 'Pick traded on to another club')) +
    row(used('2025R1 (Port Adelaide)', 'xavier_taylor/1', 'Xavier Taylor'), empty) +
    row(stated('Pick 39', 'Pick not used'), empty)
);
const parse = (html: string, slug: string, parserVersion: string) =>
  parseDraftguruTradeDetail(html, {
    capture: capture(`https://www.draftguru.com.au/trades/${slug}`, parserVersion),
    draftYear: 2024,
    effectiveAt: '2026-10-12T01:00:00.000Z',
  });
const pages = [
  [draftNight, '2024-picks-port_adelaide-west_coast-21'],
  [tradePeriod, '2024-rory-atkins-gold-coast'],
] as const;

describe('Draftguru eventual selections (draftguru-trade-parser/v3, statlyaus/Statly#886)', () => {
  it('emits exactly v2’s claims, rows and issues, followed by the eventual selections', () => {
    for (const [html, slug] of pages) {
      const v2 = parse(html, slug, DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION);
      const v3 = parse(html, slug, DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION);
      expect(v3.issues).toEqual(v2.issues);
      const head = v3.evidence.slice(0, v2.evidence.length);
      expect(head.map(({ content }) => [content.sourceRow, content.claim])).toEqual(
        v2.evidence.map(({ content }) => [content.sourceRow, content.claim])
      );
      expect(
        v3.evidence
          .slice(v2.evidence.length)
          .every(({ content }) => content.claim.kind === 'pick_eventual_selection')
      ).toBe(true);
    }
  });

  it('reads the giving side’s player for every traded pick on a draft-night page', () => {
    const result = parse(
      draftNight,
      pages[0][1],
      DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION
    );
    expect(
      result.evidence
        .map(({ content }) => content.claim)
        .filter((claim) => claim.kind === 'pick_eventual_selection')
    ).toEqual(
      [
        ['pick:2024:national:15', 'joe_berry/1', 'Joe Berry'],
        ['pick:2024:national:16', 'bo_allan/1', 'Bo Allan'],
        ['pick:2024:national:45', 'tom_gross/1', 'Tom Gross'],
      ].map(([nativeTransferId, nativeId, recordedName]) => ({
        kind: 'pick_eventual_selection',
        nativeEventId: '2024-picks-port_adelaide-west_coast-21',
        nativeTransferId,
        outcome: 'selected',
        player: { nativeId, recordedName },
      }))
    );
  });

  it('names the eventual player of a traded-on pick and a future pick, and a pick not used', () => {
    const result = parse(
      tradePeriod,
      pages[1][1],
      DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION
    );
    const eventual = result.evidence
      .map(({ content }) => content.claim)
      .filter((claim) => claim.kind === 'pick_eventual_selection');
    expect(eventual).toEqual([
      {
        kind: 'pick_eventual_selection',
        nativeEventId: '2024-rory-atkins-gold-coast',
        nativeTransferId: 'future-pick:2025:national:1:port-adelaide',
        outcome: 'selected',
        player: { nativeId: 'xavier_taylor/1', recordedName: 'Xavier Taylor' },
      },
      {
        kind: 'pick_eventual_selection',
        nativeEventId: '2024-rory-atkins-gold-coast',
        nativeTransferId: 'pick:2024:national:13',
        outcome: 'selected',
        player: { nativeId: 'bo_allan/1', recordedName: 'Bo Allan' },
      },
      {
        kind: 'pick_eventual_selection',
        nativeEventId: '2024-rory-atkins-gold-coast',
        nativeTransferId: 'pick:2024:national:39',
        outcome: 'not_used',
      },
    ]);
    // The receiving side still states v2's outcome: pick 13 was traded on.
    expect(
      result.evidence
        .map(({ content }) => content.claim)
        .find(
          (claim) =>
            claim.kind === 'pick_disposition' && claim.nativeTransferId === 'pick:2024:national:13'
        )
    ).toMatchObject({ disposition: 'traded_on' });
  });

  it('emits no eventual selection under v2, and nothing for a giving side that states none', () => {
    for (const [html, slug] of pages)
      expect(
        parse(html, slug, DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION).evidence.some(
          ({ content }) => content.claim.kind === 'pick_eventual_selection'
        )
      ).toBe(false);
    const unstated = table(
      '2024 Gold Coast and Port Adelaide Trade',
      club('Gold Coast') +
        row(stated('Pick 13', 'Pick traded on to another club'), empty) +
        club('Port Adelaide') +
        row(empty, stated('Pick 13', 'Pick traded on to another club'))
    );
    const result = parse(unstated, pages[1][1], DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION);
    expect(result.issues).toEqual([]);
    expect(
      result.evidence.some(({ content }) => content.claim.kind === 'pick_eventual_selection')
    ).toBe(false);
  });

  it('refuses an eventual selection that names a player for a pick not used, or none for one used', () => {
    const envelope = (claim: Record<string, unknown>) => () =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture: capture(
          'https://www.draftguru.com.au/trades/2024-x',
          DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION
        ),
        sourceRow: { ordinal: 1, sourceKey: 'row' },
        claim: {
          kind: 'pick_eventual_selection',
          nativeEventId: '2024-x',
          nativeTransferId: 'pick:2024:national:1',
          ...claim,
        } as never,
        publicationEligible: false,
      });
    expect(envelope({ outcome: 'selected' })).toThrow(/names a player exactly when/);
    expect(
      envelope({ outcome: 'not_used', player: { nativeId: 'x/1', recordedName: 'X' } })
    ).toThrow(/names a player exactly when/);
    expect(envelope({ outcome: 'not_used' })).not.toThrow();
  });

  it('records v3 under its own decision, with exactly v2’s fields and the new leaves', () => {
    const proposal = createDraftguruTradeAuthorityProposal({
      capabilityId: 'draftguru-trade-detail',
      parserVersion: DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION,
      seasons: [2019, 2020, 2021, 2022, 2023, 2024],
      evidenceIds: {
        productOwnerAuthorization: `artifact:${digest('4')}`,
        boundedCapturePlan: `artifact:${digest('5')}`,
        publicAccessReview: `artifact:${digest('6')}`,
        fieldBoundaryReview: `artifact:${digest('7')}`,
      },
      timing: {
        termsEffectiveAt: '2026-10-12T00:00:00.000Z',
        termsExpireAt: '2027-10-12T00:00:00.000Z',
        rightsProposedAt: '2026-10-12T00:00:01.000Z',
        proposalProposedAt: '2026-10-12T00:00:02.000Z',
      },
    });
    expect(proposal.proposal.content.decisionKey).toBe(
      'draftguru-trade-detail-issue-579-private-non_production-parser-v3'
    );
    expect(
      proposal.sourceRights.content.fields.map(({ sourceField }) => sourceField).sort()
    ).toEqual([...DRAFTGURU_TRADE_DETAIL_V3_FIELDS].sort());
    expect([...DRAFTGURU_TRADE_DETAIL_V3_FIELDS]).toEqual([
      ...DRAFTGURU_TRADE_DETAIL_V2_FIELDS,
      ...DRAFTGURU_TRADE_EVENTUAL_SELECTION_FIELDS,
    ]);
    // Every leaf v3 emits on the two pages is a reviewed field.
    const leaves = new Set<string>();
    const walk = (value: unknown, prefix: string) => {
      if (value === null || value === undefined) return;
      if (typeof value !== 'object') return void leaves.add(prefix);
      for (const [key, nested] of Object.entries(value as Record<string, unknown>))
        if (!(key === 'kind' && !prefix.includes('.'))) walk(nested, `${prefix}.${key}`);
    };
    for (const [html, slug] of pages)
      parse(html, slug, DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION).evidence.forEach(
        ({ content }) => walk(content.claim, content.claim.kind)
      );
    const fields = new Set<string>(DRAFTGURU_TRADE_DETAIL_V3_FIELDS);
    expect([...leaves].filter((leaf) => !fields.has(leaf))).toEqual([]);
  });
});
