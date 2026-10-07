import { describe, expect, it, vi } from 'vitest';

import {
  buildDraftguruCrawlPlan,
  captureDraftguruSource,
  parseDraftguruPlayerTradeDetail,
  parseDraftguruTradeDetail,
  parseDraftguruTradeIndex,
  parseDraftguruTradeIndexEvidence,
  parseDraftguruYearSelections,
} from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';

const digest = (character: string) => character.repeat(64);
const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.draftguru.com.au/trades/2025-picks-gws-western-bulldogs',
  capturedAt: '2026-08-09T01:00:00.000Z',
  effectiveAt: '2025-10-08T00:00:00.000Z',
  parserVersion: 'draftguru-trade-parser/v1',
  fieldManifestSha256: digest('3'),
} as const;

describe('Draftguru source adapter', () => {
  it('builds a deterministic bounded crawl plan', () => {
    expect(buildDraftguruCrawlPlan({ fromYear: 2024, throughYear: 2025 })).toEqual([
      'https://www.draftguru.com.au/trades',
      'https://www.draftguru.com.au/trades/year/2024',
      'https://www.draftguru.com.au/years/2024',
      'https://www.draftguru.com.au/trades/year/2025',
      'https://www.draftguru.com.au/years/2025',
    ]);
    expect(() => buildDraftguruCrawlPlan({ fromYear: 2025, throughYear: 2024 })).toThrow();
    expect(() => buildDraftguruCrawlPlan({ fromYear: 1987, throughYear: 2025 })).toThrow();
  });

  it('extracts only bounded same-host trade detail links from an index', () => {
    const result = parseDraftguruTradeIndex(
      `<a href="/trades/year/2025">2025</a>
       <a href="/trades/2025-liam-reidy">Trade</a>
       <a href="/trades/2025-liam-reidy">Duplicate</a>
       <a href="/trades/2024-old">Outside scope</a>
       <a href="https://example.com/trades/2025-bad">Foreign</a>`,
      { fromYear: 2025, throughYear: 2025 }
    );
    expect(result).toEqual(['https://www.draftguru.com.au/trades/2025-liam-reidy']);
  });

  it('turns every discovered detail URL into immutable, ordered discovery evidence', () => {
    const result = parseDraftguruTradeIndexEvidence(
      `<a href="/trades/2025-zeta">Zeta</a>
       <a href="/trades/2024-alpha">Alpha</a>
       <a href="/trades/2025-zeta">Duplicate</a>`,
      {
        capture: { ...capture, sourceUrl: 'https://www.draftguru.com.au/trades' },
        fromYear: 2024,
        throughYear: 2025,
      }
    );

    expect(result.issues).toEqual([]);
    expect(result.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'trade_detail_link',
        nativeEventId: '2024-alpha',
        anchorSeasonYear: 2024,
        sourceUrl: 'https://www.draftguru.com.au/trades/2024-alpha',
      },
      {
        kind: 'trade_detail_link',
        nativeEventId: '2025-zeta',
        anchorSeasonYear: 2025,
        sourceUrl: 'https://www.draftguru.com.au/trades/2025-zeta',
      },
    ]);
  });

  it('parses a two-party trade into one transaction, parties and paired directed assets', () => {
    const html = `
      <h2 class="heading">2025 GWS and Western Bulldogs Trade for Draft Picks</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>Greater Western Sydney</td></tr>
        <tr class="club-subheader"><td colspan="5">What GWS Gave</td><td colspan="5">What GWS Got</td></tr>
        <tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick 12</td><td class="pick-description">Traded on</td><td></td><td class="pick-points">1140 points</td><td class="expected-value">84 XG</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 14</td><td class="pick-description">Not used</td><td></td><td class="pick-points">1024 points</td><td class="expected-value">80 XG</td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr class="club-header"><td>Western Bulldogs</td></tr>
        <tr class="club-subheader"><td colspan="5">What Bulldogs Gave</td><td colspan="5">What Bulldogs Got</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 12</td><td class="player-name"><a href="/players/josh_lindsay/1">Josh Lindsay</a></td><td class="player-games">12 games</td><td class="pick-points">1140 points</td><td class="expected-value">84 XG</td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick 14</td><td class="pick-description">Not used</td><td></td><td class="pick-points">1024 points</td><td class="expected-value">80 XG</td></tr>
      </table>`;

    const result = parseDraftguruTradeDetail(html, {
      capture,
      draftYear: 2025,
      effectiveAt: '2025-10-08T00:00:00.000Z',
    });
    const claims = result.evidence.map((row) => row.content.claim);

    expect(claims.filter((claim) => claim.kind === 'transaction')).toHaveLength(1);
    expect(claims.find((claim) => claim.kind === 'transaction')).toEqual(
      expect.objectContaining({ occurredOn: null })
    );
    expect(claims.filter((claim) => claim.kind === 'transaction_party')).toHaveLength(2);
    expect(claims.filter((claim) => claim.kind === 'directed_transfer')).toHaveLength(2);
    expect(JSON.stringify(claims)).not.toContain('1140');
    expect(JSON.stringify(claims)).not.toContain('games');
    expect(JSON.stringify(claims)).not.toContain('XG');
    expect(result.issues).toEqual([]);
  });

  describe('pick dispositions (draftguru-trade-parser/v2)', () => {
    const v2Capture = { ...capture, parserVersion: 'draftguru-trade-parser/v2' };
    const html = `
      <h2 class="heading">2025 GWS and Western Bulldogs Trade for Draft Picks</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>Greater Western Sydney</td></tr>
        <tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick 12</td><td class="pick-description" colspan="2">Pick traded on to another club</td><td class="pick-points">1140 points</td><td class="expected-value">84 XG</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 14</td><td class="player-name"><a href="/players/josh_lindsay/1">Josh&nbsp;Lindsay</a></td><td class="player-games">12 games</td><td class="pick-points">1024 points</td><td class="expected-value">80 XG</td><td class="future-pick-name actual-asset">2026R2 (St Kilda)<br/><span class="pick-estimation">(estimate: pick 25)</span></td><td class="pick-description" colspan="2">Pick not used</td><td class="pick-points">500 points</td><td class="expected-value">20 XG</td></tr>
        <tr class="club-header"><td>Western Bulldogs</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 12</td><td class="pick-description" colspan="2">Pick traded on to another club</td><td class="pick-points">1140 points</td><td class="expected-value">84 XG</td><td class="pick-name actual-asset">Pick 14</td><td class="player-name"><a href="/players/josh_lindsay/1">Josh&nbsp;Lindsay</a></td><td class="player-games">12 games</td><td class="pick-points">1024 points</td><td class="expected-value">80 XG</td></tr>
        <tr class="movement"><td class="future-pick-name actual-asset">2026R2 (St Kilda)<br/><span class="pick-estimation">(estimate: pick 25)</span></td><td class="pick-description" colspan="2">Pick not used</td><td class="pick-points">500 points</td><td class="expected-value">20 XG</td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>`;
    const parse = (input = html, parserCapture: typeof capture | typeof v2Capture = v2Capture) =>
      parseDraftguruTradeDetail(input, {
        capture: parserCapture,
        draftYear: 2025,
        effectiveAt: '2025-10-08T00:00:00.000Z',
      });
    const dispositions = (result: ReturnType<typeof parse>) =>
      result.evidence
        .map(({ content }) => content.claim)
        .filter((claim) => claim.kind === 'pick_disposition');

    it('records each received pick’s stated outcome on the receiving side only', () => {
      const result = parse();
      expect(result.issues).toEqual([]);
      expect(dispositions(result)).toEqual([
        {
          kind: 'pick_disposition',
          nativeEventId: '2025-picks-gws-western-bulldogs',
          nativeTransferId: 'future-pick:2026:national:2:st-kilda',
          receivingClub: { nativeId: null, recordedName: 'Greater Western Sydney' },
          disposition: 'not_used',
        },
        {
          kind: 'pick_disposition',
          nativeEventId: '2025-picks-gws-western-bulldogs',
          nativeTransferId: 'pick:2025:national:12',
          receivingClub: { nativeId: null, recordedName: 'Greater Western Sydney' },
          disposition: 'traded_on',
        },
        {
          kind: 'pick_disposition',
          nativeEventId: '2025-picks-gws-western-bulldogs',
          nativeTransferId: 'pick:2025:national:14',
          receivingClub: { nativeId: null, recordedName: 'Western Bulldogs' },
          disposition: 'selected',
          player: { nativeId: 'josh_lindsay/1', recordedName: 'Josh Lindsay' },
        },
      ]);
    });

    it('binds every disposition to a directed transfer in the same capture', () => {
      const result = parse();
      const transferIds = new Set(
        result.evidence
          .map(({ content }) => content.claim)
          .flatMap((claim) => (claim.kind === 'directed_transfer' ? [claim.nativeTransferId] : []))
      );
      for (const disposition of dispositions(result)) {
        expect(transferIds.has(disposition.nativeTransferId)).toBe(true);
      }
    });

    it('never emits games, points, expected-value or estimate text', () => {
      const serialized = JSON.stringify(parse().evidence.map(({ content }) => content.claim));
      for (const excluded of ['games', 'points', 'XG', 'estimate', '1024', '1140']) {
        expect(serialized).not.toContain(excluded);
      }
    });

    it('quarantines an unrecognised disposition instead of guessing', () => {
      const result = parse(html.replace('Pick not used', 'Pick swapped at the draft'));
      expect(dispositions(result).map(({ disposition }) => disposition)).toEqual([
        'traded_on',
        'selected',
      ]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'unsupported_disposition' })
      );
    });

    it('emits nothing new for a v1 capture, whose recorded rights do not name dispositions', () => {
      expect(dispositions(parse(html, capture))).toEqual([]);
    });
  });

  it('projects one exact player transfer without admitting unrelated pick movements', () => {
    const html = `
      <h2 class="heading">2025 GWS and Western Bulldogs Trade</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>Greater Western Sydney</td></tr>
        <tr class="movement"><td class="player-name actual-asset"><a href="/players/sam_taylor/1">Sam Taylor</a></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick 12</td><td></td><td></td><td></td><td></td></tr>
        <tr class="club-header"><td>Western Bulldogs</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 12</td><td></td><td></td><td></td><td></td><td class="player-name actual-asset"><a href="/players/sam_taylor/1">Sam Taylor</a></td><td></td><td></td><td></td><td></td></tr>
      </table>`;

    const result = parseDraftguruPlayerTradeDetail(html, {
      capture: { ...capture, parserVersion: 'draftguru-player-trade-parser/v1' },
      draftYear: 2025,
      effectiveAt: '2025-10-08T00:00:00.000Z',
      playerNativeId: 'sam_taylor/1',
    });

    expect(result.issues).toEqual([]);
    expect(result.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'transaction',
      'transaction_party',
      'transaction_party',
      'directed_transfer',
    ]);
    expect(result.evidence[3]?.content.claim).toMatchObject({
      kind: 'directed_transfer',
      asset: { kind: 'player', player: { nativeId: 'sam_taylor/1' } },
    });
  });

  it('quarantines an unpaired trade side instead of inventing direction', () => {
    const html = `
      <h2 class="heading">2025 Trade</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>Club A</td></tr>
        <tr class="club-subheader"><td colspan="5">Gave</td><td colspan="5">Got</td></tr>
        <tr class="movement"><td class="pick-name actual-asset">Pick 14</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>`;
    const result = parseDraftguruTradeDetail(html, {
      capture,
      draftYear: 2025,
      effectiveAt: '2025-10-08T00:00:00.000Z',
    });
    expect(result.evidence.some((row) => row.content.claim.kind === 'directed_transfer')).toBe(
      false
    );
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unpaired_asset' }));
  });

  it('preserves future-pick year, round and original club instead of dropping the leg', () => {
    const html = `
      <h2 class="heading">2025 Trade for Liam Ryan</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>St Kilda</td></tr>
        <tr class="movement"><td class="future-pick-name actual-asset">2026R2 (St Kilda)<br><span>(estimate: pick 25)</span></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr class="club-header"><td>West Coast</td></tr>
        <tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="future-pick-name actual-asset">2026R2 (St Kilda)<br><span>(estimate: pick 25)</span></td><td></td><td></td><td></td><td></td></tr>
      </table>`;
    const result = parseDraftguruTradeDetail(html, {
      capture,
      draftYear: 2025,
      effectiveAt: '2025-10-08T00:00:00.000Z',
    });

    expect(result.issues).toEqual([]);
    expect(result.evidence.map((row) => row.content.claim)).toContainEqual({
      kind: 'directed_transfer',
      nativeEventId: '2025-picks-gws-western-bulldogs',
      nativeTransferId: 'future-pick:2026:national:2:st-kilda',
      fromClub: { nativeId: null, recordedName: 'St Kilda' },
      toClub: { nativeId: null, recordedName: 'West Coast' },
      asset: {
        kind: 'future_pick',
        draftYear: 2026,
        draftType: 'national',
        roundNumber: 2,
        originalClub: { nativeId: null, recordedName: 'St Kilda' },
      },
    });
  });

  it('quarantines every non-empty movement side that it cannot parse', () => {
    const html = `
      <h2 class="heading">2025 Trade</h2>
      <table class="individual-trade">
        <tr class="club-header"><td>Club A</td></tr>
        <tr class="movement"><td class="future-pick-name actual-asset">Mystery future selection</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      </table>`;
    const result = parseDraftguruTradeDetail(html, {
      capture,
      draftYear: 2025,
      effectiveAt: '2025-10-08T00:00:00.000Z',
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_asset',
        sourceKey: expect.stringContaining('gave'),
      })
    );
  });

  it('extracts draft selections from the year table while ignoring grades and outcomes', () => {
    const html = `
      <h2 class="heading">2025 AFL Draft and Trade Period</h2>
      <table class="big-pick-movements"><tbody>
        <tr><td class="category"></td><td class="draft">National</td><td class="number">14</td><td class="club"><a href="/clubs/sydney">Sydney</a></td><td class="category">Academy</td><td class="player"><a href="/players/harry_kyle/1">Harry Kyle</a></td><td></td><td></td><td></td><td class="grade">D</td><td class="games">7</td></tr>
        <tr><td class="category">Trade</td><td class="draft"></td><td class="number"></td><td class="club">Carlton</td><td></td><td class="player">Liam Reidy</td><td></td><td></td><td></td><td class="grade">D</td><td class="games">4</td></tr>
      </tbody></table>`;
    const result = parseDraftguruYearSelections(html, {
      capture: {
        ...capture,
        sourceUrl: 'https://www.draftguru.com.au/years/2025',
        parserVersion: 'draftguru-event-year/v2',
      },
      draftYear: 2025,
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.content.claim).toEqual({
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
      roundNumber: null,
      player: { nativeId: 'harry_kyle/1', recordedName: 'Harry Kyle' },
      selectedByClub: { nativeId: 'sydney', recordedName: 'Sydney' },
    });
    expect(result.issues).toEqual([]);
    expect(result.scopeSummary).toEqual({
      observedRows: 2,
      includedRows: 1,
      invalidRows: 0,
      excludedByPathway: { Trade: 1 },
    });
    expect(JSON.stringify(result.evidence)).not.toContain('grade');
    expect(JSON.stringify(result.evidence)).not.toContain('games');
  });

  it('enforces response status, content type and byte bounds before custody', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"unchanged"' } }))
      .mockResolvedValueOnce(
        new Response('not html', { status: 200, headers: { 'content-type': 'text/plain' } })
      )
      .mockResolvedValueOnce(
        new Response('x'.repeat(21), {
          status: 200,
          headers: { 'content-type': 'text/html', 'content-length': '21' },
        })
      );

    await expect(
      captureDraftguruSource({
        url: 'https://www.draftguru.com.au/trades',
        fetchImpl,
        maximumBytes: 20,
        validators: { eTag: '"unchanged"', lastModified: null },
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'not_modified' }));
    await expect(
      captureDraftguruSource({
        url: 'https://www.draftguru.com.au/trades',
        fetchImpl,
        maximumBytes: 20,
        validators: null,
      })
    ).rejects.toThrow(/content type/i);
    await expect(
      captureDraftguruSource({
        url: 'https://www.draftguru.com.au/trades',
        fetchImpl,
        maximumBytes: 20,
        validators: null,
      })
    ).rejects.toThrow(/maximum/i);
  });
});
