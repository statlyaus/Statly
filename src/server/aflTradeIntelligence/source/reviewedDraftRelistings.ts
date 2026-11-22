/**
 * Owner-reviewed draft numbers a club used to re-list its own delisted players (owner, 2026-11-22:
 * "New rule, then ship"). The Official AFL night report states these numbers inside a session's range,
 * but the Draftguru year page prints no row for them, so no reviewed selection holds them. A listed
 * number counts only while the cited night-session evidence is in the reconciled source set (see
 * `aflTradeReviewedRelistedNumbers` in `externalEvidenceReconciliation.ts`): then it is reached in that
 * session, and it is never a selection, so never a nominee of any club.
 */

export interface AflTradeReviewedDraftRelisting {
  readonly draftYear: number;
  readonly draftType: string;
  readonly selectionNumbers: readonly number[];
  /** The Official AFL boundary-session evidence whose range states these numbers. */
  readonly evidenceId: string;
  readonly note: string;
}

export const AFL_TRADE_REVIEWED_DRAFT_RELISTINGS: readonly AflTradeReviewedDraftRelisting[] = [
  {
    draftYear: 2026,
    draftType: 'national',
    selectionNumbers: [63, 64],
    evidenceId:
      'external-evidence:59ab104af5b67fc7edd4d192d63f67397f71e745c973e32a6e21ce13a7536041',
    note: "2026 national picks 63 and 64 were Gold Coast's own, used to re-list its delisted Himmelberg and Ugle-Hagan (access open), as the Official AFL night-2 report states (capture source-capture:91db63f8de62b5d0473c7696643188604581efe43d52ad6c50384cd5d9768b32); Draftguru prints no row for them (owner, 2026-11-22).",
  },
];
