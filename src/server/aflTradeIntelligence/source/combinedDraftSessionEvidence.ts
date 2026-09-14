import {
  parseDraftSessionDatePrecision,
  draftSessionDefinitelyPrecedes,
  type DraftSessionDatePrecision,
} from './draftSessionDatePrecision';
import {
  resolveCompletedDraftMembership,
  resolveCompletedDraftCapacityExhaustion,
  type CompletedDraftSelectionCapacity,
  type CompletedDraftMembershipRoster,
  type CompletedDraftMemberNumber,
  type CompletedDraftMemberExclusion,
} from './completedDraftMembership';

export interface CombinedDraftSelection {
  selectionId: string;
  selectionNumber: number;
  playerId: string;
  clubId: string;
}

interface CombinedDraftFactBase {
  evidenceId: string;
  captureId: string;
  artifactId: string;
  documentId: string;
}

export type CombinedDraftSessionFact =
  | CompletedDraftSelectionCapacity
  | CompletedDraftMembershipRoster
  | CompletedDraftMemberNumber
  | CompletedDraftMemberExclusion
  | (CombinedDraftFactBase & {
      kind: 'completed_session_date';
      sessionOrdinal: number;
      eventDate: string;
    })
  | (CombinedDraftFactBase & {
      kind: 'completed_session_window';
      sessionOrdinal: number;
      datePrecision: Extract<DraftSessionDatePrecision, { precision: 'window' }>;
    })
  | (CombinedDraftFactBase & {
      kind: 'completed_session';
      sessionOrdinal: number;
    })
  | (CombinedDraftFactBase & {
      kind: 'session_boundary';
      sessionOrdinal: number;
      boundary: 'first' | 'last';
      selectionNumber: number;
      playerId: string;
      clubId: string;
    })
  | (CombinedDraftFactBase & {
      kind: 'completed_draft_total';
      selectionCount: number;
    })
  | (CombinedDraftFactBase & {
      kind: 'completed_draft_inventory';
      selectionNumbers: readonly number[];
    });

export interface CombinedDraftSessionCoverage {
  draftYear: number;
  draftType: string;
  officialName: string;
  sessionOrdinal: number;
  eventDate: string;
  selectionIds: string[];
  evidenceIds: string[];
}

export interface CombinedDraftSessionProjection {
  schemaVersion: 'afl-trade-combined-draft-session-projection/v1';
  inventorySelectionIds: string[];
  selectedSelectionIds: string[];
  inventorySessions: CombinedDraftSessionCoverage[];
  selectedSessions: CombinedDraftSessionCoverage[];
}

/** Prove the complete inventory before projecting the selections required by a candidate.
 * Source and identity authority must still be authenticated by the persistence owner.
 */
export function projectCombinedDraftSessionEvidence(
  input: Parameters<typeof resolveCombinedDraftSessionEvidence>[0] & {
    selectedSelectionIds: readonly string[];
  }
): CombinedDraftSessionProjection {
  const inventorySessions = resolveCombinedDraftSessionEvidence(input);
  const inventorySelectionIds = input.selections.map(({ selectionId }) => selectionId).sort();
  const selectedSelectionIds = [...input.selectedSelectionIds].sort();
  const inventory = new Set(inventorySelectionIds);
  if (
    selectedSelectionIds.length === 0 ||
    new Set(selectedSelectionIds).size !== selectedSelectionIds.length ||
    selectedSelectionIds.some((id) => !inventory.has(id))
  ) {
    throw new TypeError(
      'Session projection requires a nonempty unique subset of the proved inventory.'
    );
  }
  const selected = new Set(selectedSelectionIds);
  return {
    schemaVersion: 'afl-trade-combined-draft-session-projection/v1',
    inventorySelectionIds,
    selectedSelectionIds,
    inventorySessions,
    selectedSessions: inventorySessions
      .map((session) => ({
        ...session,
        selectionIds: session.selectionIds.filter((id) => selected.has(id)),
        evidenceIds: [...session.evidenceIds],
      }))
      .filter(({ selectionIds }) => selectionIds.length > 0),
  };
}

const unique = <T>(values: T[]) => [...new Set(values)];

export interface ReportedDraftSessionProjection extends Omit<
  CombinedDraftSessionProjection,
  'schemaVersion'
> {
  schemaVersion: 'afl-trade-reported-draft-session-projection/v1';
}

/** Direct session claims must partition the retained inventory before selecting candidate members. */
export function projectReportedDraftSessionEvidence(input: {
  draftYear: number;
  draftType: string;
  selections: { selectionId: string; selectionNumber: number }[];
  sessions: {
    sessionOrdinal: number;
    eventDate: string;
    officialName: string;
    selectionNumbers: readonly number[];
    evidenceIds: readonly string[];
  }[];
  selectedSelectionIds: readonly string[];
}): ReportedDraftSessionProjection {
  const byNumber = new Map(
    input.selections.map((selection) => [selection.selectionNumber, selection])
  );
  const inventorySelectionIds = input.selections.map(({ selectionId }) => selectionId).sort();
  const selectedSelectionIds = [...input.selectedSelectionIds].sort();
  if (
    !inventorySelectionIds.length ||
    byNumber.size !== inventorySelectionIds.length ||
    new Set(inventorySelectionIds).size !== inventorySelectionIds.length ||
    input.selections.some(
      (s) => !s.selectionId || !Number.isInteger(s.selectionNumber) || s.selectionNumber < 1
    ) ||
    !selectedSelectionIds.length ||
    new Set(selectedSelectionIds).size !== selectedSelectionIds.length ||
    selectedSelectionIds.some((id) => !inventorySelectionIds.includes(id))
  )
    throw new TypeError(
      'Reported session projection requires unique inventory and selected membership.'
    );

  const byOrdinal = new Map<number, CombinedDraftSessionCoverage>();
  for (const claim of input.sessions) {
    const numbers = [...claim.selectionNumbers].sort((a, b) => a - b);
    if (
      !numbers.length ||
      unique(numbers).length !== numbers.length ||
      numbers.some((number) => !byNumber.has(number)) ||
      !claim.evidenceIds.length ||
      claim.evidenceIds.some((id) => !id.trim()) ||
      !claim.officialName.trim() ||
      !Number.isInteger(claim.sessionOrdinal) ||
      claim.sessionOrdinal < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(claim.eventDate) ||
      !Number.isFinite(Date.parse(claim.eventDate)) ||
      new Date(claim.eventDate).toISOString().slice(0, 10) !== claim.eventDate ||
      Number(claim.eventDate.slice(0, 4)) !== input.draftYear
    )
      throw new TypeError(
        'Reported session claim has invalid dates, evidence or inventory membership.'
      );
    const session: CombinedDraftSessionCoverage = {
      draftYear: input.draftYear,
      draftType: input.draftType,
      sessionOrdinal: claim.sessionOrdinal,
      eventDate: claim.eventDate,
      officialName: claim.officialName,
      selectionIds: numbers.map((number) => byNumber.get(number)!.selectionId).sort(),
      evidenceIds: unique([...claim.evidenceIds]).sort(),
    };
    const prior = byOrdinal.get(claim.sessionOrdinal);
    if (prior) {
      if (
        prior.eventDate !== session.eventDate ||
        prior.officialName !== session.officialName ||
        JSON.stringify(prior.selectionIds) !== JSON.stringify(session.selectionIds)
      )
        throw new TypeError('Reported session claims disagree on exact date or membership.');
      session.evidenceIds = unique([...prior.evidenceIds, ...session.evidenceIds]).sort();
    }
    byOrdinal.set(claim.sessionOrdinal, session);
  }
  const inventorySessions = [...byOrdinal.values()].sort(
    (a, b) => a.sessionOrdinal - b.sessionOrdinal
  );
  const members = inventorySessions.flatMap((session) => session.selectionIds).sort();
  if (
    JSON.stringify(members) !== JSON.stringify(inventorySelectionIds) ||
    inventorySessions.some(
      (session, index) =>
        session.sessionOrdinal !== index + 1 ||
        (index > 0 && session.eventDate < inventorySessions[index - 1]!.eventDate)
    )
  )
    throw new TypeError(
      'Reported sessions must completely partition the inventory in chronological order.'
    );
  const selected = new Set(selectedSelectionIds);
  return {
    schemaVersion: 'afl-trade-reported-draft-session-projection/v1',
    inventorySelectionIds,
    selectedSelectionIds,
    inventorySessions,
    selectedSessions: inventorySessions
      .map((session) => ({
        ...session,
        selectionIds: session.selectionIds.filter((id) => selected.has(id)),
        evidenceIds: [...session.evidenceIds],
      }))
      .filter((session) => session.selectionIds.length > 0),
  };
}

function requireOne<T>(values: T[], message: string): T {
  if (values.length !== 1) throw new TypeError(message);
  return values[0]!;
}

export type PrecisionDraftSessionCoverage = Omit<CombinedDraftSessionCoverage, 'eventDate'> & {
  eventDate: string | null;
  datePrecision?: Extract<DraftSessionDatePrecision, { precision: 'window' }>;
};

interface CombinedDraftSessionInput {
  draftYear: number;
  draftType: string;
  officialName: string;
  selections: CombinedDraftSelection[];
  facts: CombinedDraftSessionFact[];
}

export interface PrecisionDraftSessionProjection {
  schemaVersion: 'afl-trade-combined-draft-session-projection/v2';
  inventorySelectionIds: string[];
  selectedSelectionIds: string[];
  inventorySessions: PrecisionDraftSessionCoverage[];
  selectedSessions: PrecisionDraftSessionCoverage[];
}

/** A versioned proof preserves date bounds when projecting a verified full inventory. */
export function projectPrecisionDraftSessionEvidence(
  input: CombinedDraftSessionInput & { selectedSelectionIds: readonly string[] }
): PrecisionDraftSessionProjection {
  const inventorySessions = resolvePrecisionDraftSessionEvidence(input);
  const inventorySelectionIds = input.selections.map((s) => s.selectionId).sort();
  const selectedSelectionIds = [...input.selectedSelectionIds].sort();
  const inventory = new Set(inventorySelectionIds);
  if (
    !selectedSelectionIds.length ||
    new Set(selectedSelectionIds).size !== selectedSelectionIds.length ||
    selectedSelectionIds.some((id) => !inventory.has(id))
  ) {
    throw new TypeError(
      'Session projection requires a nonempty unique subset of the proved inventory.'
    );
  }
  const selected = new Set(selectedSelectionIds);
  return {
    schemaVersion: 'afl-trade-combined-draft-session-projection/v2',
    inventorySelectionIds,
    selectedSelectionIds,
    inventorySessions,
    selectedSessions: inventorySessions
      .map((session) => ({
        ...session,
        selectionIds: session.selectionIds.filter((id) => selected.has(id)),
        evidenceIds: [...session.evidenceIds],
        ...(session.datePrecision ? { datePrecision: { ...session.datePrecision } } : {}),
      }))
      .filter((session) => session.selectionIds.length > 0),
  };
}

/** Legacy consumers must explicitly opt into window-aware proof handling. */
export function resolveCombinedDraftSessionEvidence(
  input: CombinedDraftSessionInput
): CombinedDraftSessionCoverage[] {
  return resolvePrecisionDraftSessionEvidence(input).map((session) => {
    if (session.eventDate === null || session.datePrecision !== undefined)
      throw new TypeError(
        'Session window requires a precision-aware projection and promotion owner.'
      );
    return { ...session, eventDate: session.eventDate };
  });
}

export function resolvePrecisionDraftSessionEvidence(
  input: CombinedDraftSessionInput
): PrecisionDraftSessionCoverage[] {
  const orderedSelections = [...input.selections].sort(
    (left, right) => left.selectionNumber - right.selectionNumber
  );
  const totals = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_draft_total' }> =>
      fact.kind === 'completed_draft_total'
  );
  const inventoryNumbers = orderedSelections.map(({ selectionNumber }) => selectionNumber);
  const capacities = input.facts.filter(
    (fact): fact is CompletedDraftSelectionCapacity => fact.kind === 'draft_selection_capacity'
  );
  let total: number;
  if (capacities.length) {
    if (totals.length)
      throw new TypeError(
        'Choose one explicit completeness mechanism; do not mix capacity with completed totals.'
      );
    const capacity = requireOne(
      capacities,
      'Capacity exhaustion requires exactly one reviewed capacity.'
    );
    const roster = requireOne(
      input.facts.filter(
        (fact): fact is CompletedDraftMembershipRoster =>
          fact.kind === 'completed_draft_membership_roster'
      ),
      'Capacity exhaustion requires one completed roster.'
    );
    const completion = requireOne(
      input.facts.filter(
        (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_session' }> =>
          fact.kind === 'completed_session'
      ),
      'Capacity exhaustion requires one completed session.'
    );
    if (completion.sessionOrdinal !== 1)
      throw new TypeError('Capacity exhaustion requires the reviewed single mini-draft session.');
    const proof = resolveCompletedDraftCapacityExhaustion({
      draftYear: input.draftYear,
      draftType: input.draftType,
      inventoryNumbers,
      capacity,
      roster,
      completion: { ...completion, draftYear: input.draftYear, draftType: input.draftType },
    });
    total = proof.selectionNumbers.length;
  } else {
    total = requireOne(
      unique(totals.map(({ selectionCount }) => selectionCount)),
      'Combined draft proof requires one agreed completed selection total.'
    );
  }
  const enumerations = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_draft_inventory' }> =>
      fact.kind === 'completed_draft_inventory'
  );
  if (
    orderedSelections.length !== total ||
    inventoryNumbers.some((number) => !Number.isInteger(number) || number < 1) ||
    unique(inventoryNumbers).length !== total ||
    unique(orderedSelections.map(({ selectionId }) => selectionId)).length !== total
  ) {
    throw new TypeError('Combined draft proof requires a complete unique inventory.');
  }
  const rosters = input.facts.filter(
    (fact): fact is CompletedDraftMembershipRoster =>
      fact.kind === 'completed_draft_membership_roster'
  );
  const bindings = input.facts.filter(
    (fact): fact is CompletedDraftMemberNumber => fact.kind === 'completed_draft_member_number'
  );
  const exclusions = input.facts.filter(
    (fact): fact is CompletedDraftMemberExclusion =>
      fact.kind === 'completed_draft_member_exclusion'
  );
  if (
    rosters.length > 1 ||
    ((bindings.length > 0 || exclusions.length > 0) && rosters.length !== 1)
  ) {
    throw new TypeError(
      'Member-number evidence requires one explicit completed membership roster.'
    );
  }
  if (rosters.length === 1) {
    resolveCompletedDraftMembership({
      draftYear: input.draftYear,
      draftType: input.draftType,
      inventoryNumbers,
      roster: rosters[0]!,
      bindings,
      exclusions,
    });
  }
  if (enumerations.length === 0 && rosters.length === 0) {
    if (inventoryNumbers.some((number, index) => number !== index + 1)) {
      throw new TypeError(
        'A noncontiguous inventory requires explicit completed membership evidence.'
      );
    }
  } else if (
    enumerations.some(({ selectionNumbers }) => {
      const numbers = [...selectionNumbers].sort((a, b) => a - b);
      return (
        numbers.length !== total ||
        numbers.some((number, index) => number !== inventoryNumbers[index])
      );
    })
  ) {
    throw new TypeError(
      'Completed membership must match every original inventory selection number.'
    );
  }

  const boundaries = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'session_boundary' }> =>
      fact.kind === 'session_boundary'
  );
  const dates = input.facts.filter(
    (
      fact
    ): fact is Extract<
      CombinedDraftSessionFact,
      { kind: 'completed_session_date' | 'completed_session_window' }
    > => fact.kind === 'completed_session_date' || fact.kind === 'completed_session_window'
  );
  const completions = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_session' }> =>
      fact.kind === 'completed_session'
  );
  const ordinals = unique(dates.map(({ sessionOrdinal }) => sessionOrdinal)).sort(
    (left, right) => left - right
  );
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new TypeError('Combined draft sessions require consecutive ordinals beginning at one.');
  }
  if (
    ordinals.some(
      (sessionOrdinal) =>
        !completions.some((completion) => completion.sessionOrdinal === sessionOrdinal)
    ) ||
    completions.some((completion) => !ordinals.includes(completion.sessionOrdinal))
  ) {
    throw new TypeError('Every dated session requires explicit completed-session evidence.');
  }
  const starts = ordinals.map((sessionOrdinal) =>
    requireOne(
      boundaries.filter(
        (fact) => fact.sessionOrdinal === sessionOrdinal && fact.boundary === 'first'
      ),
      'Every combined draft session requires one explicit first-selection boundary.'
    )
  );
  if (starts[0]?.selectionNumber !== 1) {
    throw new TypeError('The first combined draft session must explicitly begin at selection one.');
  }
  if (
    starts.some(
      (start, index) => index > 0 && start.selectionNumber <= starts[index - 1]!.selectionNumber
    )
  ) {
    throw new TypeError('Combined draft session boundaries must be strictly increasing.');
  }
  const finalOrdinal = ordinals.at(-1);
  const finalBoundary = requireOne(
    boundaries.filter((fact) => fact.sessionOrdinal === finalOrdinal && fact.boundary === 'last'),
    'The final combined draft session requires one explicit terminal boundary.'
  );
  if (finalBoundary.selectionNumber !== inventoryNumbers.at(-1)) {
    throw new TypeError('The terminal boundary must agree with the complete inventory.');
  }
  for (const boundary of boundaries) {
    const sessionIndex = ordinals.indexOf(boundary.sessionOrdinal);
    if (sessionIndex === -1) {
      throw new TypeError('A boundary refers to an unknown combined draft session.');
    }
    const nextStart = starts[sessionIndex + 1];
    const expectedNumber =
      boundary.boundary === 'first'
        ? starts[sessionIndex]!.selectionNumber
        : nextStart
          ? inventoryNumbers[inventoryNumbers.indexOf(nextStart.selectionNumber) - 1]
          : inventoryNumbers.at(-1);
    if (boundary.selectionNumber !== expectedNumber) {
      throw new TypeError('Combined draft evidence contains a contradictory session boundary.');
    }
    const selection = orderedSelections.find(
      ({ selectionNumber }) => selectionNumber === boundary.selectionNumber
    );
    if (
      !boundary.playerId.trim() ||
      !boundary.clubId.trim() ||
      selection?.playerId !== boundary.playerId ||
      selection.clubId !== boundary.clubId
    ) {
      throw new TypeError('A session boundary identity disagrees with the complete inventory.');
    }
  }
  if (
    [...totals, ...capacities].every(
      (fact) =>
        fact.documentId === finalBoundary.documentId ||
        fact.captureId === finalBoundary.captureId ||
        fact.artifactId === finalBoundary.artifactId
    )
  ) {
    throw new TypeError('The completed total requires an independent authenticated document.');
  }

  const evidenceIds = unique(input.facts.map(({ evidenceId }) => evidenceId)).sort();
  const precisionByOrdinal = new Map(
    ordinals.map((sessionOrdinal) => {
      const claims = dates
        .filter((fact) => fact.sessionOrdinal === sessionOrdinal)
        .map((fact) =>
          parseDraftSessionDatePrecision(
            fact.kind === 'completed_session_date'
              ? { precision: 'day', eventDate: fact.eventDate }
              : fact.datePrecision,
            input.draftYear
          )
        );
      const agreed = requireOne(
        unique(claims.map((value) => JSON.stringify(value))),
        'Every combined draft session requires one agreed date precision.'
      );
      const precision = claims.find((value) => JSON.stringify(value) === agreed)!;
      return [sessionOrdinal, precision] as const;
    })
  );
  return ordinals.map((sessionOrdinal, index) => {
    const precision = precisionByOrdinal.get(sessionOrdinal)!;
    const prior = index > 0 ? precisionByOrdinal.get(ordinals[index - 1]!)! : null;
    if (prior && !draftSessionDefinitelyPrecedes(prior, precision)) {
      throw new TypeError(
        'Combined draft session date bounds must be strictly increasing without overlap.'
      );
    }
    const first = starts[index]!.selectionNumber;
    const nextStart = starts[index + 1];
    const last = nextStart ? nextStart.selectionNumber - 1 : finalBoundary.selectionNumber;
    return {
      draftYear: input.draftYear,
      draftType: input.draftType,
      officialName: input.officialName,
      sessionOrdinal,
      eventDate: precision.eventDate,
      ...(precision.precision === 'window' ? { datePrecision: precision } : {}),
      selectionIds: orderedSelections
        .filter(({ selectionNumber }) => selectionNumber >= first && selectionNumber <= last)
        .map(({ selectionId }) => selectionId)
        .sort(),
      evidenceIds,
    };
  });
}
