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
    // Owner, 2026-10-25: "Approve all 7". Each is a stated not-used draft-night id (rule R2: mid-draft,
    // holder matched a bid) whose holder's board spend joins the order pick named here.
    {
      pickId: 'draft-pick:cb8eb88d26cd23a648fad728e3415a9a96d44df4387e872b8793772bad1a358a',
      samePickId: 'draft-pick:071672ad44f339f3bc065502ad39361c080734819ca8dfee3959ac261e971bb2',
      note: '2019 Sydney→Brisbane "#47" (draft-night pick trade 46) is Sydney\'s R3 pick 44 in the 2019 order; Brisbane spent "R3 (SYD) - Pick 44" on Keidean Coleman.',
    },
    {
      pickId: 'draft-pick:2067315a16c59e1e64b55c82663670b29f83b53c0741b3d9176cc75b91565738',
      samePickId: 'draft-pick:03edb2212228eb3e9c46f563e0b5aecddc74211d77694eebb942dc00fdc8f94c',
      note: '2020 GWS→Footscray "#29" (the end of the Port Adelaide→Essendon→GWS→Footscray relay chain) is Fremantle\'s R2 pick 29, held by Footscray in the 2020-12-04 order; Footscray spent "R2 (FRE) - Pick 29" on Jamarra Ugle-Hagan.',
    },
    {
      pickId: 'draft-pick:9d4a33234186f10ddb1e1dd7110114505915e01b7c575863bb9c8e2a406464d6',
      samePickId: 'draft-pick:3161283c87dd8aee2c2f1211b9254706680881e50d03734fcd9b3851782a26b0',
      note: '2020 Fremantle→Brisbane "#35" (draft-night pick trade 42) is Melbourne\'s R2 pick 32, which Fremantle held; Brisbane spent "R2 (MEL) - Pick 32" on Blake Coleman.',
    },
    {
      pickId: 'draft-pick:54b294016e142ee20595e8fa6326f2f21b464758cdcc2032a6b4d5425b53af2d',
      samePickId: 'draft-pick:56be3bffdb76b7fedf5b0019762670f1571c74feccabc464d5e544bbfe81614c',
      note: '2020 Gold Coast→Sydney "#37" is Brisbane\'s R2 pick 37 (Gold Coast\'s from the 2019 Ah Chee trade), held by Sydney in the 2020-12-04 order; Sydney spent "R2 (BRL) - Pick 37" on Braeden Campbell.',
    },
    {
      pickId: 'draft-pick:4ec150f8b8958e4c5ca5bc0dde86df7b0168a73e5dc8f7a56251b43c6e05cae9',
      samePickId: 'draft-pick:28ef5ba417ea708954934d644d1620068905335eac3f488f7a86ac5c47538595',
      note: '2023 Carlton→Gold Coast "#26" (the Hollands trade) is Hawthorn\'s R2 pick 26, held by Gold Coast in the 2023-11-16 order; Gold Coast spent "R2 (HAW) - Pick 26" on Jed Walter.',
    },
    {
      pickId: 'draft-pick:03ce5c30188186eb8ca52642f33d2b47d7b9b3ebe4d4ff6f92d1cf0cca216cae',
      samePickId: 'draft-pick:f6b43cca86033b19d19e65e3808510fa391fef97f6afc53674cb17bb0e816927',
      note: '2023 Melbourne→Gold Coast "#35" (pick trade 5) is Melbourne\'s R2 pick 36, held by Gold Coast in the 2023-11-16 order; Gold Coast spent "R2 (MEL) - Pick 36" on Ethan Read.',
    },
    {
      pickId: 'draft-pick:c5ab4d47d30e5213bc51a98cd7fc5b8cb78254a6747b2948a99849caf4fde037',
      samePickId: 'draft-pick:0e4a0fb9838bb7a4c6081e2976c55efba20c822d2af7980092565498585b22c1',
      note: '2023 Gold Coast→Footscray "#46" (pick trade 1) is Gold Coast\'s R3 pick 48, held by Footscray in the 2023-11-16 order; Footscray spent "R3 (GCS) - Pick 48" on Jordan Croft.',
    },
  ];

/**
 * A relay the owner reviewed (#1050; owner, 2026-10-26: "Approve all four"): the holder of `transferId`'s
 * pick traded that pick on as `onwardTransferId`, under another pick id and a number rule R1 cannot match
 * (the indicative order renumbered it between the two trades, or the pick id's hops do not chain). The
 * ledger and the structure still require the same draft, another pick id, the holder as sender and a
 * trade no earlier; the number is not checked.
 */
export interface AflTradeAssetLedgerReviewedRelay {
  readonly transferId: string;
  readonly onwardTransactionId: string;
  readonly onwardTransferId: string;
  readonly note: string;
}

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_RELAYS: readonly AflTradeAssetLedgerReviewedRelay[] = [
  {
    transferId:
      'external-transfer:4189cf8d9db8a6182fb98fadc72d1b546aee35f650f627d62efc7d57fee78384',
    onwardTransactionId:
      'external-transaction:f1dc44ea9234f67cd82b13e70bfc10cd704cc2e12162919189e2f7854272ec6f',
    onwardTransferId:
      'external-transfer:97bd7277599f2124416d2e15c0cebbb02b6ff521555a0bd4d9fbf861c017e70e',
    note: '2022 GWS→Collingwood "#40" (the Bobby Hill trade) is GWS\'s R3, which Collingwood passed to Hawthorn as "#41" (the Mitchell/Stephens/Henry trade); the 2022 order lists #41 R3 orig GWS held by Hawthorn, and Hawthorn passed it to Brisbane, who spent it on Will Ashcroft.',
  },
  {
    transferId:
      'external-transfer:395c527a449a916d76bd07550b351a1c42a708c0bdedc85c86fdf60d03279fa5',
    onwardTransactionId:
      'external-transaction:a86bc6839d0409e6a02224310267f0ea6b1ecb7a96590416129b610c0b5ae6b1',
    onwardTransferId:
      'external-transfer:a6c87eb1d6520ec79892410303c2e7528e21291a2e57a0ce681ca25b57664871',
    note: '2025 Fremantle→Melbourne "#23" (the McVee trade; West Coast→Fremantle "#23" relays into it) is West Coast\'s R2, which Melbourne passed to Gold Coast as "pick 24" (the Petracca trade), the reviewed same pick as the order\'s #24 R2 orig West Coast spent on Zeke Uwland.',
  },
  {
    transferId:
      'external-transfer:33de4b4744beddd5bfee5bed966e479376d929c9ab8f8103e3a720ab6fdee331',
    onwardTransactionId:
      'external-transaction:1008dbf3d761a1656b628ca8088f5c06fd67e95d628ff53f3367734abab54ef4',
    onwardTransferId:
      'external-transfer:c9d141a4a09d0581f245b5cba0e5e4a2b712b909ac86dc8dfeb9081d0eee8f88',
    note: '2022 Hawthorn→Sydney (Hawthorn\'s 2023 R3, round only) went on as Sydney→Melbourne "#46" (the Grundy trade). The pick came back to Hawthorn, who held it at #47 in the 2023 order and spent "R3 (HAW) - Pick 47" on Will McCabe.',
  },
  {
    transferId:
      'external-transfer:c9d141a4a09d0581f245b5cba0e5e4a2b712b909ac86dc8dfeb9081d0eee8f88',
    onwardTransactionId:
      'external-transaction:7d935cd8d88256229987bbed18bdc8563a50bc7a5a3f769980435ddfa3c9b198',
    onwardTransferId:
      'external-transfer:866918f7bcd24d5732572dde2b1fc81e9a24b5db87db1573cdc5da01a9cd0abc',
    note: '2023 Sydney→Melbourne "#46" (Grundy) went on as Melbourne→Brisbane "#47" (the Fullarton trade): Hawthorn\'s 2023 R3, renumbered by the indicative order between the two trades.',
  },
  {
    transferId:
      'external-transfer:866918f7bcd24d5732572dde2b1fc81e9a24b5db87db1573cdc5da01a9cd0abc',
    onwardTransactionId:
      'external-transaction:974278ea2c2294f092e405dea42f3074cc16263962c20556744a3382639f93cc',
    onwardTransferId:
      'external-transfer:9de85d8d22f0c251b1821cabed672dbdb1aa7f2a5ba6d36f5df3a52ec9d7c6b7',
    note: '2023 Melbourne→Brisbane "#47" (Fullarton) went on as Brisbane→Hawthorn "#47" (the Gunston/Ryan trade), back to the pick id Draftguru gave Hawthorn\'s R3 in 2022.',
  },
];

/**
 * A hop whose stated "not used" the owner reviewed as traded on: the receiving club passed the pick on,
 * and the reviewed relay above names where. The ledger reads the hop as traded on, so the pick's end is
 * its other hop (#1050; owner, 2026-10-26).
 */
export interface AflTradeAssetLedgerReviewedTradedOn {
  readonly transferId: string;
  readonly note: string;
}

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_TRADED_ON: readonly AflTradeAssetLedgerReviewedTradedOn[] =
  [
    {
      transferId:
        'external-transfer:33de4b4744beddd5bfee5bed966e479376d929c9ab8f8103e3a720ab6fdee331',
      note: '2022 Hawthorn→Sydney, Hawthorn\'s 2023 R3: Draftguru says Sydney did not use it because Sydney traded it on as "#46"; the pick\'s end is Hawthorn\'s own hop back (Brisbane→Hawthorn "#47"), spent on Will McCabe.',
    },
    {
      transferId:
        'external-transfer:065d8397aea0ac306264e902153820315ac41546cb967cb6fa3ee1e0a74d77ca',
      note: '2020 North Melbourne→Collingwood "pick 26 (Hawthorn)", Hawthorn\'s 2020 R2: Draftguru states Collingwood selected it, but Collingwood traded it on to the Bulldogs (then GWS) and got it back from GWS as "pick 30". The Footyinfo board shows one pick on that whole route, used by Collingwood at selection 31 on Liam McMahon; the end is GWS→Collingwood.',
    },
    {
      transferId:
        'external-transfer:e0fbe7bac03998339192ac045fe17c225400cf911bfedfed77c6c90db4571802',
      note: '2023 Melbourne→St Kilda "2024 round 3 (Melbourne)": Draftguru states St Kilda selected it, but St Kilda traded it to Essendon as "pick 47" and got it back as "pick 44" in 2024. The Footyinfo board shows one pick on route Melbourne, St Kilda, Essendon, St Kilda, used at selection 45 on Hugh Boxshall; the end is Essendon→St Kilda.',
    },
    {
      transferId:
        'external-transfer:026e6a3631b7ff0ed7f0a42f5ca9e364063377f2d9f43b1dacdff15ab09aa1b7',
      note: '2024 Bulldogs→Brisbane "2025 round 3 (Western Bulldogs)": the 2025-11-07 Official AFL order lists the Bulldogs\' R3 at 53 held by the Bulldogs, and Brisbane\'s R3 picks there are West Coast\'s, Collingwood\'s and Carlton\'s, so Brisbane passed it back by a move the trade sources do not hold. The end is the Bulldogs→Gold Coast "pick 53", which Gold Coast spent as "R3 (WBD) - Pick 53" on Beau Addinsall.',
    },
  ];

/**
 * A stated not-used pick the owner reviewed as used: the holder took the named selection with it under a
 * shifted live number, which the cited Official AFL order row and Footyinfo board row show (#1050;
 * owner, 2026-10-25: "Do them in this wake"). The ledger refuses an entry whose selection is not the
 * holder's, or not of the pick's draft.
 */
export interface AflTradeAssetLedgerReviewedSelected {
  readonly pickId: string;
  readonly selectionId: string;
  /** The order and board rows the review rests on. */
  readonly custodyId: string;
  readonly boardPickId: string;
  readonly note: string;
}

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_SELECTED: readonly AflTradeAssetLedgerReviewedSelected[] =
  [
    {
      pickId: 'draft-pick:0552a97ae41226ab222f0b7ac61e536138cef73116885a6ce70ecdef44776fdd',
      selectionId:
        'external-draft-selection:e60a8bd7b998bc80d76d33e661f5ac92989c21930b8c6d0f72a89c2843d23cdb',
      custodyId:
        'external-pick-custody:7950ab712982641f495efe3b4aa781ea6b1851639f691e3bf98e1950df3ed6ae',
      boardPickId:
        'external-draft-board-pick:adf55d5404ddc89e10b502e5a43eb1595eb7f4983e2a95effdff0e05f9305cd0',
      note: '2023 North Melbourne→Carlton "#25" (the Zac Fisher trade; Sydney→North Melbourne "#25" relays into it) is the R1 pick the 2023-11-16 order lists at 22 held by Carlton; the board shows Carlton used original 22 at selection 29, Ashton Moir. Draftguru says not used only because no selection 25 was Carlton\'s.',
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
