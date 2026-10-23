/**
 * Board spent picks joined to a ledger pick by owner review (statlyaus/Statly#789; owner, 2026-10-21:
 * "Approve 1-5"). Each has no custody slot and no single exact trade match: the pick's number moved
 * between the trade and the draft, or it reached the trading club before the trade window. Keyed by
 * the board bid match and the board's native pick id; the pick must be held by the bidding club at
 * the draft, or the ledger refuses.
 */
export interface AflTradeAssetLedgerReviewedBidSpend {
  readonly bidMatchId: string;
  readonly nativePickId: string;
  readonly pickId: string;
  readonly note: string;
}

export const AFL_TRADE_ASSET_LEDGER_REVIEWED_BID_SPENDS: readonly AflTradeAssetLedgerReviewedBidSpend[] =
  [
    {
      bidMatchId:
        'external-draft-board-bid-match:1b002210c0094addabe7198693e3f385877bb26ca80b4d0afee624d615caf725',
      nativePickId: '6163',
      pickId: 'draft-pick:c266f669534ace2a951e1301273191afaf81cb3d22626d79bc6c8a2f35eaf283',
      note: '2023 Gold Coast spent "R3 (NTH) - Pick 46": the pick 46 Fremantle traded to Gold Coast.',
    },
    {
      bidMatchId:
        'external-draft-board-bid-match:6e772373caa173784d6202047b3ec50f6bf25503bde0225f7cd0917f022420f4',
      nativePickId: '6161',
      pickId: 'draft-pick:e1188850ebe30cdee22d38bb10f75aa508603134b6fcaf4fa95a2bea9cb5a48e',
      note: '2023 Gold Coast spent "R2 (MEL) - Pick 42": the pick 42 St Kilda traded to Gold Coast.',
    },
    {
      bidMatchId:
        'external-draft-board-bid-match:ff444e393b60317f7486b250b6e57558ea5366382a87dfab3351a02c6c2fbb89',
      nativePickId: '7364',
      pickId: 'draft-pick:777776aca12064bfab83ec907222647be66874a9d995df27a3b1309207dfd3e5',
      note: '2020 Port Adelaide spent "R2 (ADE) - Pick 40": Adelaide\'s only pick to Port, traded as 38.',
    },
    {
      bidMatchId:
        'external-draft-board-bid-match:b12340dc8362fb43486a0d9dab793e879d4166810fa12739facb8c00ceadd9cb',
      nativePickId: '6502',
      pickId: 'draft-pick:e75e24ad0f0044c867bab7e975ba25151b980adebb15728b9deee8dcc84def2a',
      note: '2025 Brisbane spent "R1 (WCE) - Pick 23": West Coast\'s pick to Brisbane, traded as 22.',
    },
    {
      bidMatchId:
        'external-draft-board-bid-match:b12340dc8362fb43486a0d9dab793e879d4166810fa12739facb8c00ceadd9cb',
      nativePickId: '6501',
      pickId: 'draft-pick:618caa91c9b1190860f210def54a9719bb2b9cbb74582e8e6f722b61e3364ada',
      note: '2025 Brisbane spent "R1 (CAR) - Pick 22": the pick 22 Hawthorn traded to Brisbane.',
    },
    {
      bidMatchId:
        'external-draft-board-bid-match:73d98b4889ae4fea425e0cf2f4b752d5c5c4e6850b3a1d3665ba21c1eaad2718',
      nativePickId: '7365',
      pickId: 'draft-pick:20e765fd58f7d00bb80feabc3a466f147f33950b7bb347c644f18a14faa23a08',
      note: '2020 Collingwood spent "R3 (HAW) - Pick 46" on Reef McInnes: Hawthorn\'s "#42" from the draft-week swap with "#41" (owner, 2026-10-23, #1050 B).',
    },
  ];
