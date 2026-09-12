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
  | (CombinedDraftFactBase & {
      kind: 'completed_session_date';
      sessionOrdinal: number;
      eventDate: string;
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

const unique = <T>(values: T[]) => [...new Set(values)];

function requireOne<T>(values: T[], message: string): T {
  if (values.length !== 1) throw new TypeError(message);
  return values[0]!;
}

export function resolveCombinedDraftSessionEvidence(input: {
  draftYear: number;
  draftType: string;
  officialName: string;
  selections: CombinedDraftSelection[];
  facts: CombinedDraftSessionFact[];
}): CombinedDraftSessionCoverage[] {
  const orderedSelections = [...input.selections].sort(
    (left, right) => left.selectionNumber - right.selectionNumber
  );
  const totals = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_draft_total' }> =>
      fact.kind === 'completed_draft_total'
  );
  const total = requireOne(
    unique(totals.map(({ selectionCount }) => selectionCount)),
    'Combined draft proof requires one agreed completed selection total.'
  );
  if (
    orderedSelections.length !== total ||
    orderedSelections.some((selection, index) => selection.selectionNumber !== index + 1) ||
    unique(orderedSelections.map(({ selectionId }) => selectionId)).length !== total
  ) {
    throw new TypeError('Combined draft proof requires a complete unique contiguous inventory.');
  }

  const boundaries = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'session_boundary' }> =>
      fact.kind === 'session_boundary'
  );
  const dates = input.facts.filter(
    (fact): fact is Extract<CombinedDraftSessionFact, { kind: 'completed_session_date' }> =>
      fact.kind === 'completed_session_date'
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
    boundaries.filter(
      (fact) => fact.sessionOrdinal === finalOrdinal && fact.boundary === 'last'
    ),
    'The final combined draft session requires one explicit terminal boundary.'
  );
  if (finalBoundary.selectionNumber !== total) {
    throw new TypeError('The terminal boundary must agree with the completed draft total.');
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
          ? nextStart.selectionNumber - 1
          : total;
    if (boundary.selectionNumber !== expectedNumber) {
      throw new TypeError('Combined draft evidence contains a contradictory session boundary.');
    }
    const selection = orderedSelections[boundary.selectionNumber - 1];
    if (selection?.playerId !== boundary.playerId || selection.clubId !== boundary.clubId) {
      throw new TypeError('A session boundary identity disagrees with the complete inventory.');
    }
  }
  if (
    totals.every(
      (fact) =>
        fact.documentId === finalBoundary.documentId ||
        fact.captureId === finalBoundary.captureId ||
        fact.artifactId === finalBoundary.artifactId
    )
  ) {
    throw new TypeError('The completed total requires an independent authenticated document.');
  }

  const evidenceIds = unique(input.facts.map(({ evidenceId }) => evidenceId)).sort();
  return ordinals.map((sessionOrdinal, index) => {
    const date = requireOne(
      unique(
        dates
          .filter((fact) => fact.sessionOrdinal === sessionOrdinal)
          .map(({ eventDate }) => eventDate)
      ),
      'Every combined draft session requires one agreed completed date.'
    );
    const priorDate =
      index > 0
        ? requireOne(
            unique(
              dates
                .filter((fact) => fact.sessionOrdinal === sessionOrdinal - 1)
                .map(({ eventDate }) => eventDate)
            ),
            'Every combined draft session requires one agreed completed date.'
          )
        : null;
    if (priorDate && date <= priorDate) {
      throw new TypeError('Combined draft session dates must be strictly increasing.');
    }
    const first = starts[index]!.selectionNumber;
    const nextStart = starts[index + 1];
    const last = nextStart ? nextStart.selectionNumber - 1 : finalBoundary.selectionNumber;
    return {
      draftYear: input.draftYear,
      draftType: input.draftType,
      officialName: input.officialName,
      sessionOrdinal,
      eventDate: date,
      selectionIds: orderedSelections
        .filter(
          ({ selectionNumber }) => selectionNumber >= first && selectionNumber <= last
        )
        .map(({ selectionId }) => selectionId)
        .sort(),
      evidenceIds,
    };
  });
}
