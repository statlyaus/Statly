import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalAssetJson,
  draftguruEventIdFromUrl,
  summariseDraftguruTradeDetailValidation,
  validateDraftguruTradeDetail,
  type DraftguruTradeDetailValidationOutcome,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeDetailValidation';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const entry = (url: string, sha: string) => ({
  url,
  sha256: sha,
  bodyFile: `${sha}.html`,
  recordedAt: '2026-09-12T07:39:19.710635+00:00',
  authority: 'public_inspection_not_governed_capture',
  factsValidated: false,
});

const tradePage = (title: string, clubA: string, clubB: string) => `
  <h2 class="heading">${title}</h2>
  <table class="individual-trade">
    <tr class="club-header"><td>${clubA}</td></tr>
    <tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick 12</td><td></td><td></td><td></td><td></td></tr>
    <tr class="club-header"><td>${clubB}</td></tr>
    <tr class="movement"><td class="pick-name actual-asset">Pick 12</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
  </table>`;

function outcome(
  overrides: Partial<DraftguruTradeDetailValidationOutcome> & { eventId: string }
): DraftguruTradeDetailValidationOutcome {
  return {
    bodyShaMatches: true,
    parsed: null,
    issues: [],
    parties: [],
    assetKinds: [],
    transfers: [],
    statesExplicitDate: false,
    ...overrides,
  };
}

describe('canonicalAssetJson', () => {
  it('is order-independent at every depth', () => {
    expect(canonicalAssetJson({ kind: 'player', player: { nativeId: 'a', name: 'A' } })).toBe(
      canonicalAssetJson({ player: { name: 'A', nativeId: 'a' }, kind: 'player' })
    );
  });

  it('keeps nested asset identity, so two different players never collide', () => {
    // Filtering to top-level keys would drop `nativeId` and report false duplicates.
    expect(canonicalAssetJson({ kind: 'player', player: { nativeId: 'a' } })).not.toBe(
      canonicalAssetJson({ kind: 'player', player: { nativeId: 'b' } })
    );
  });
});

describe('draftguruEventIdFromUrl', () => {
  it('reads the native event id from a trade detail URL', () => {
    expect(draftguruEventIdFromUrl('https://www.draftguru.com.au/trades/2025-liam-reidy')).toBe(
      '2025-liam-reidy'
    );
    expect(draftguruEventIdFromUrl('https://www.draftguru.com.au/trades/year/2025')).toBeNull();
  });
});

describe('validateDraftguruTradeDetail', () => {
  it('parses a captured trade into parties, asset kinds and one directed transfer per movement', () => {
    const html = tradePage('2025 GWS and Western Bulldogs Trade for Draft Picks', 'GWS', 'Bulldogs');
    const result = validateDraftguruTradeDetail({
      entry: entry('https://www.draftguru.com.au/trades/2025-gws-bulldogs', sha256(html)),
      html,
    });

    expect(result?.eventId).toBe('2025-gws-bulldogs');
    expect(result?.bodyShaMatches).toBe(true);
    expect(result?.issues).toEqual([]);
    expect(result?.parties).toEqual(['GWS', 'Bulldogs']);
    // The page states the same movement under both clubs; the parser collapses it rather than
    // reporting the trade twice, which is why a two-asset trade yields two transfers, not four.
    expect(result?.assetKinds).toEqual(['current_pick']);
    expect(result?.transfers).toHaveLength(1);
    for (const transfer of result?.transfers ?? []) {
      expect(transfer.fromClub).not.toBe('');
      expect(transfer.toClub).not.toBe('');
      expect(transfer.fromClub).not.toBe(transfer.toClub);
      expect(transfer.assetSignature).toContain('current_pick');
    }
  });

  it('reports a body that does not match its recorded hash', () => {
    const html = tradePage('2025 GWS Trade', 'GWS', 'Bulldogs');
    const result = validateDraftguruTradeDetail({
      entry: entry('https://www.draftguru.com.au/trades/2025-gws-bulldogs', sha256('other')),
      html,
    });

    expect(result?.bodyShaMatches).toBe(false);
  });

  it('reports whether the page states an exact date instead of assuming one', () => {
    const undated = tradePage('1988 Trade for Alex Ishchenko', 'Brisbane', 'West Coast');
    const url = 'https://www.draftguru.com.au/trades/1988-alex-ishchenko';
    expect(
      validateDraftguruTradeDetail({ entry: entry(url, sha256(undated)), html: undated })
        ?.statesExplicitDate
    ).toBe(false);

    const dated = `${undated}\n<p>Traded 1988-10-08</p>`;
    expect(
      validateDraftguruTradeDetail({ entry: entry(url, sha256(dated)), html: dated })
        ?.statesExplicitDate
    ).toBe(true);
  });

  it('refuses a URL that is not one trade detail page', () => {
    expect(
      validateDraftguruTradeDetail({
        entry: entry('https://www.draftguru.com.au/trades/year/2025', sha256('x')),
        html: 'x',
      })
    ).toBeNull();
  });
});

describe('summariseDraftguruTradeDetailValidation', () => {
  const transfer = (nativeTransferId: string, from: string, to: string, signature: string) => ({
    nativeTransferId,
    fromClub: from,
    toClub: to,
    assetSignature: signature,
  });

  it('counts asset kinds the trace cannot express, and says how many', () => {
    const summary = summariseDraftguruTradeDetailValidation([
      outcome({ eventId: '2020-a', assetKinds: ['player', 'special_pick'] }),
      outcome({ eventId: '2020-b', assetKinds: ['current_pick'] }),
    ]);

    expect(summary.assetKinds).toEqual({ player: 1, special_pick: 1, current_pick: 1 });
    expect(summary.unexpressibleAssetKindCount).toBe(1);
  });

  it('separates a repeated movement from a repeated transfer id', () => {
    const summary = summariseDraftguruTradeDetailValidation([
      outcome({
        eventId: '2020-a',
        // Distinct ids carrying an identical movement, which is the case the trace must not duplicate.
        transfers: [transfer('pick:1', 'A', 'B', 'x'), transfer('pick:3', 'A', 'B', 'x')],
      }),
    ]);

    expect(summary.withinEventDuplicates).toHaveLength(1);
    expect(summary.duplicateTransferIds).toEqual([]);
  });

  it('flags a repeated transfer id', () => {
    const summary = summariseDraftguruTradeDetailValidation([
      outcome({
        eventId: '2020-a',
        transfers: [transfer('pick:1', 'A', 'B', 'x'), transfer('pick:1', 'A', 'B', 'x')],
      }),
    ]);

    expect(summary.duplicateTransferIds).toEqual(['2020-a:pick:1']);
    expect(summary.withinEventDuplicates).toHaveLength(1);
  });

  it('groups distinct trades that carry an identical transfer set, in order-independent fashion', () => {
    const moves = [transfer('pick:1', 'A', 'B', 'x'), transfer('player:p', 'B', 'A', 'y')];
    const summary = summariseDraftguruTradeDetailValidation([
      outcome({ eventId: '1996-a', transfers: moves }),
      outcome({ eventId: '1997-b', transfers: [...moves].reverse() }),
      outcome({ eventId: '1997-c', transfers: [transfer('pick:9', 'A', 'B', 'z')] }),
    ]);

    expect(summary.crossEventDuplicateGroups).toEqual([['1996-a', '1997-b']]);
  });

  it('reports hash mismatches, parse issues and the party distribution together', () => {
    const summary = summariseDraftguruTradeDetailValidation([
      outcome({ eventId: '2020-a', parties: ['A', 'B'] }),
      outcome({ eventId: '2020-b', parties: ['A', 'B', 'C'], bodyShaMatches: false }),
      outcome({
        eventId: '2020-c',
        parties: ['A', 'B', 'C', 'D'],
        issues: [{ code: 'unsupported_asset', detail: 'cash' }],
      }),
      null,
    ]);

    expect(summary.entries).toBe(3);
    expect(summary.unparsableEntries).toBe(1);
    expect(summary.hashMismatches).toBe(1);
    expect(summary.parsedWithoutIssues).toBe(2);
    expect(summary.issues).toEqual({ unsupported_asset: 1 });
    expect(summary.partyDistribution).toBe('2:1 3:1 4:1');
  });
});
