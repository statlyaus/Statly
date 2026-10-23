/**
 * Owner-reviewed links for pending matched-bid picks (statlyaus/Statly#1050; owner, 2026-10-23:
 * "Approve A–D"; and the Petracca trade's pick 24, owner 2026-10-23: "Yes, link it"). Draft-week pick swaps state a live number and no original club, so the swapped pick
 * gets its own pick id, a duplicate of a pick already traded under another id. Draftguru says the
 * duplicate was not used because the receiving club spent it on a bid, and the board's spend joins
 * the other id. Each entry names one pending pick; the ledger refuses an entry whose bid or board row
 * is not the holding club's.
 */

/** The pending pick is the same physical pick as `samePickId`: it takes that pick's bid spend. */
export interface AflTradeAssetLedgerReviewedSamePick {
  readonly pickId: string;
  readonly samePickId: string;
  readonly note: string;
}

/** The pending pick was passed at the draft by its holder, as the named board row states. */
export interface AflTradeAssetLedgerReviewedPassed {
  readonly pickId: string;
  readonly boardPickId: string;
  readonly note: string;
}

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_SAME_PICKS: readonly AflTradeAssetLedgerReviewedSamePick[] =
  [
    {
      pickId: 'draft-pick:57214c2fd2e7e5d01f24badefdeb7e15cde24e8670a6207129872bdd86893a8d',
      samePickId: 'draft-pick:922e6fb916f516749d0eb9ef68138f2da30a2f430912fc740ebe26713fc9d4bb',
      note: '2019 Carlton→Port Adelaide "#55" (draft-night swap) is Geelong\'s R3 pick 57, which Carlton held (Geelong→Essendon→Carlton); Port spent "R3 (GEE) - Pick 57" on Jackson Mead.',
    },
    {
      pickId: 'draft-pick:73be803941d9929c32f6ae03b64409c9f1678f539cee14559fff4a3378323292',
      samePickId: 'draft-pick:49e6b7d5fb602c30bd617bf45497ce1d82229a71c6c8fa0d2da3af021abf0dfc',
      note: '2020 Hawthorn→Collingwood "#41" (one swap with "#42") is Hawthorn\'s R3 pick 45; Collingwood spent "R3 (HAW) - Pick 45" on Reef McInnes.',
    },
    {
      pickId: 'draft-pick:bb1fe9c841d7ec02e4fa44588da76bddee3d48600a22c910ef892d1c5f4c0033',
      samePickId: 'draft-pick:6d141772c4861edde5fd788893185f2f6ac094657e2e9a6a36418b68c211ce43',
      note: '2019 Sydney→Port Adelaide "#65" (draft-night swap) is North Melbourne\'s R4 pick 65; Port spent "R4 (NTH) - Pick 65" on Jackson Mead.',
    },
    {
      pickId: 'draft-pick:4b36e22a0a21887185c75853a2d3c52659aacee3ccc69279eacf218a1ce5d02a',
      samePickId: 'draft-pick:1f33de70d85287bed31f2eb0684093925bac2361471a07f777f4b66bf2bed22f',
      note: '2025 Melbourne→Gold Coast "pick 24" (the Petracca trade) is West Coast\'s R2 pick 24; Gold Coast spent "R2 (WCE) - Pick 24" on Zeke Uwland (owner, 2026-10-23).',
    },
  ];

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_PASSED: readonly AflTradeAssetLedgerReviewedPassed[] =
  [
    {
      pickId: 'draft-pick:ca4dbff9a16934a21550c8b46a236fb9fcb7bc7da865888fbfe808e3372fdf13',
      boardPickId:
        'external-draft-board-pick:aaa89daf4ff12606af6293ba1d8508b6c1177ac01cdf9d749d0aa837f5b4a7fb',
      note: '2020 North Melbourne R4 pick 63, held by Fremantle: the board shows Fremantle passed on it.',
    },
  ];
