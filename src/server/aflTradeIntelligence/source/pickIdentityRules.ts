import { createAflTradeContentAddress } from '../artifacts/contentAddress';

/**
 * The draft-pick identity rules (docs/architecture/afl-draft-pick-identity-rules.md, issue 853) as a
 * pure check over candidate content. Finalization enforces the same rules in the database (migration
 * 0273); this mirror lets the reconciler's tests and read-only audits state exactly what the database
 * would refuse. Every rule compares resolved clubs only and ignores records without a pick id.
 */

interface PickAssetLike {
  readonly kind: string;
  readonly pickId?: string;
  readonly draftYear?: number;
  readonly draftType?: string;
  readonly nominalPick?: number | null;
  readonly nominalRound?: number | null;
  readonly originalClubId?: string | null;
}

export interface AflTradePickIdentityContentLike {
  readonly transfers: readonly {
    readonly transferId: string;
    readonly transactionId: string;
    readonly fromClubId: string | null;
    readonly toClubId: string | null;
    readonly asset: PickAssetLike;
  }[];
  readonly draftSelections: readonly {
    readonly selectionId: string;
    readonly draftYear: number;
    readonly draftType: string;
    readonly selectionNumber: number;
    readonly pickId: string;
    readonly clubId: string | null;
    readonly supportingProviders: readonly string[];
  }[];
  readonly pickCustody: readonly {
    readonly pickId: string;
    readonly originalClubId: string | null;
  }[];
  readonly pickLineage: readonly { readonly pickId: string; readonly selectionId: string }[];
  readonly pickOutcomes?: readonly {
    readonly transferId: string;
    readonly playerId: string | null;
  }[];
  readonly draftBoardPicks?: readonly {
    readonly draftYear: number;
    readonly draftType: string;
    readonly recordedPickNumber: number | null;
    readonly status: string;
    readonly clubId: string | null;
    readonly routeClubIds: readonly string[] | null;
  }[];
  readonly issues: readonly { readonly code: string; readonly subjectKey: string }[];
}

export interface AflTradePickIdentityViolation {
  readonly rule: 1 | 2 | 3 | 4 | 5 | 6;
  /** The pick id the rule names, and for rule 1 the transaction. */
  readonly pickId: string;
  readonly transactionId?: string;
  readonly detail: string;
}

/**
 * The address a pick id has when only its number formed it (`pickId` in the reconciler): draft year,
 * draft type, pick number and round, with nothing scoping it to one transfer or entitlement.
 */
export function aflTradeNumberOnlyPickId(asset: PickAssetLike): string | null {
  if (asset.draftYear === undefined || asset.draftType === undefined) return null;
  return createAflTradeContentAddress('draft-pick', {
    draftYear: asset.draftYear,
    draftType: asset.draftType,
    nominalPick: asset.nominalPick ?? null,
    nominalRound: asset.nominalRound ?? null,
  });
}

/** Whether a candidate records a `pick_identity_conflict` on the pick (rule 7). */
export function aflTradePickConflictRecorded(
  issues: AflTradePickIdentityContentLike['issues'],
  pickId: string
): boolean {
  return issues.some(
    ({ code, subjectKey }) =>
      code === 'pick_identity_conflict' &&
      (subjectKey === `pick-custody:${pickId}` || subjectKey.startsWith(`pick-custody:${pickId}|`))
  );
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (value === null) continue;
    (groups.get(value) ?? groups.set(value, []).get(value)!).push(row);
  }
  return groups;
}

const repeats = (values: readonly (string | null | undefined)[]) => {
  const resolved = values.filter((value): value is string => typeof value === 'string');
  return resolved.length > new Set(resolved).size;
};

/** Every rule a candidate breaks, in rule order; an empty list is what finalization accepts. */
export function aflTradePickIdentityViolations(
  content: AflTradePickIdentityContentLike
): AflTradePickIdentityViolation[] {
  const violations: AflTradePickIdentityViolation[] = [];
  const picks = content.transfers.filter(
    (transfer) => transfer.asset.kind === 'pick_entitlement' && transfer.asset.pickId !== undefined
  );
  const pickIdOf = (transfer: (typeof picks)[number]) => transfer.asset.pickId!;

  // Rule 1: one exchange moves an id at most once from and once into any resolved club, under one number.
  groupBy(picks, (transfer) => `${transfer.transactionId}|${pickIdOf(transfer)}`).forEach(
    (group) => {
      const numbers = new Set(
        group.flatMap(({ asset }) =>
          typeof asset.nominalPick === 'number' ? [asset.nominalPick] : []
        )
      );
      if (
        repeats(group.map(({ fromClubId }) => fromClubId)) ||
        repeats(group.map(({ toClubId }) => toClubId)) ||
        numbers.size > 1
      ) {
        violations.push({
          rule: 1,
          pickId: pickIdOf(group[0]!),
          transactionId: group[0]!.transactionId,
          detail: 'One exchange moves the pick twice from or into one club, or under two numbers.',
        });
      }
    }
  );

  // Rule 2: an id's transfers and custody rows name at most one original club.
  const originals = groupBy(
    [
      ...picks.map((transfer) => ({
        pickId: pickIdOf(transfer),
        original: transfer.asset.originalClubId ?? null,
      })),
      ...content.pickCustody.map(({ pickId, originalClubId }) => ({
        pickId,
        original: originalClubId,
      })),
    ].filter(({ original }) => original !== null),
    ({ pickId }) => pickId
  );
  originals.forEach((rows, pickId) => {
    if (new Set(rows.map(({ original }) => original)).size > 1) {
      violations.push({ rule: 2, pickId, detail: 'The pick names two original clubs.' });
    }
  });

  // Rule 3: the stated outcomes on one id name at most one drafted player.
  const transferPick = new Map(picks.map((transfer) => [transfer.transferId, pickIdOf(transfer)]));
  groupBy(
    (content.pickOutcomes ?? []).filter(({ playerId }) => playerId !== null),
    ({ transferId }) => transferPick.get(transferId) ?? null
  ).forEach((outcomes, pickId) => {
    if (new Set(outcomes.map(({ playerId }) => playerId)).size > 1) {
      violations.push({
        rule: 3,
        pickId,
        detail: 'Outcomes on the pick name two drafted players.',
      });
    }
  });

  // Rule 4: one selection per id, and a pick's lineage names at most one selection.
  groupBy(content.draftSelections, ({ pickId }) => pickId).forEach((selections, pickId) => {
    if (selections.length > 1) {
      violations.push({ rule: 4, pickId, detail: 'Two selections share the pick.' });
    }
  });
  groupBy(content.pickLineage, ({ pickId }) => pickId).forEach((lineage, pickId) => {
    if (new Set(lineage.map(({ selectionId }) => selectionId)).size > 1) {
      violations.push({ rule: 4, pickId, detail: 'The pick’s lineage names two selections.' });
    }
  });

  // Rule 5: a transfer on a routed selected pick that is not a hop of the route is a recorded conflict.
  const transfersOnPick = groupBy(picks, pickIdOf);
  for (const board of content.draftBoardPicks ?? []) {
    const route = board.routeClubIds;
    if (board.status !== 'selected' || route === null || route.length < 2) continue;
    const selection = content.draftSelections.find(
      (candidate) =>
        candidate.draftYear === board.draftYear &&
        candidate.draftType === board.draftType &&
        candidate.selectionNumber === board.recordedPickNumber
    );
    if (
      selection === undefined ||
      selection.clubId === null ||
      selection.clubId !== board.clubId ||
      selection.supportingProviders.every((provider) => provider === 'footyinfo')
    )
      continue;
    const offRoute = (transfersOnPick.get(selection.pickId) ?? []).some(
      ({ fromClubId, toClubId }) =>
        fromClubId !== null &&
        toClubId !== null &&
        !route.some((club, at) => at > 0 && route[at - 1] === fromClubId && club === toClubId)
    );
    if (offRoute && !aflTradePickConflictRecorded(content.issues, selection.pickId)) {
      violations.push({
        rule: 5,
        pickId: selection.pickId,
        detail:
          'A transfer on a routed selected pick is off the route and no conflict is recorded.',
      });
    }
  }

  // Rule 6: a number-only id is never shared across transactions or with a selection. An id a custody
  // observation carries is a custody id, whatever its form (earlier reconcilers keyed some by number).
  const selectionPicks = new Set(content.draftSelections.map(({ pickId }) => pickId));
  const custodyPicks = new Set(content.pickCustody.map(({ pickId }) => pickId));
  const reported = new Set<string>();
  for (const transfer of picks) {
    const pickId = pickIdOf(transfer);
    if (
      reported.has(pickId) ||
      custodyPicks.has(pickId) ||
      pickId !== aflTradeNumberOnlyPickId(transfer.asset)
    )
      continue;
    const shared =
      selectionPicks.has(pickId) ||
      (transfersOnPick.get(pickId) ?? []).some(
        ({ transactionId }) => transactionId !== transfer.transactionId
      );
    if (shared) {
      reported.add(pickId);
      violations.push({
        rule: 6,
        pickId,
        detail: 'A number-only pick id is shared across transactions or with a selection.',
      });
    }
  }
  return violations;
}
