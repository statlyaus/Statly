import type { AflTradeGate0AReceipt } from './gate0aReceipt';
import type { AflTradeSourceRightsProposal } from './sourceRights';
import type { AflTradeExternalEvidenceEnvelope } from './externalDraftTradeEvidenceContracts';

function presentLeafPaths(value: unknown, prefix: string): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => presentLeafPaths(item, prefix));
  }
  if (typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    key === 'kind' && prefix.indexOf('.') < 0
      ? []
      : presentLeafPaths(nested, prefix ? `${prefix}.${key}` : key)
  );
}

/**
 * Proves that every non-null source fact emitted by a parser has an exact reviewed source-field
 * mapping and was requested for archive use in the effective Gate 0A evaluation. Parser literals
 * and missing/null fields do not create source authority implicitly.
 */
export function requireAflTradeExternalEvidenceFieldAuthority(input: {
  evidence: readonly AflTradeExternalEvidenceEnvelope[];
  sourceRights: AflTradeSourceRightsProposal;
  gate0aReceipt: AflTradeGate0AReceipt;
}): void {
  // A page's acquisition year need not equal the event year of every selection it contains.
  // Field permission alone cannot extend the approved factual season scope.
  const unsupportedSelectionYears = input.evidence.flatMap(({ content }) => {
    const claim = content.claim;
    if (claim.kind !== 'draft_selection') return [];
    return input.sourceRights.content.scope.seasonRanges.some(
      ({ from, to }) => from <= claim.draftYear && claim.draftYear <= to
    )
      ? []
      : [claim.draftYear];
  });
  if (unsupportedSelectionYears.length > 0) {
    throw new TypeError(
      `Draft selection event years outside approved source scope: ${[...new Set(unsupportedSelectionYears)].sort((a, b) => a - b).join(', ')}`
    );
  }
  const unsupportedCompensationYears = input.evidence.flatMap(({ content }) => {
    const claim = content.claim;
    const year =
      claim.kind === 'compensation_rule_reference'
        ? claim.awardYear
        : claim.kind === 'compensation_activation_reference'
          ? claim.useYear
          : undefined;
    if (year === undefined) return [];
    return input.sourceRights.content.scope.seasonRanges.some(
      ({ from, to }) => from <= year && year <= to
    )
      ? []
      : [year];
  });
  if (unsupportedCompensationYears.length > 0) {
    throw new TypeError(
      `Compensation event years outside approved source scope: ${[...new Set(unsupportedCompensationYears)].sort((a, b) => a - b).join(', ')}`
    );
  }
  const unsupportedDepartureYears = input.evidence.flatMap(({ content }) => {
    const claim = content.claim;
    if (claim.kind !== 'player_departure_reference') return [];
    return input.sourceRights.content.scope.seasonRanges.some(
      ({ from, to }) => from <= claim.departureYear && claim.departureYear <= to
    )
      ? []
      : [claim.departureYear];
  });
  if (unsupportedDepartureYears.length > 0) {
    throw new TypeError('Player departure event years outside approved source scope.');
  }
  for (const {
    content: { claim },
  } of input.evidence) {
    if (claim.kind !== 'player_continuity_reference') continue;
    for (const year of [...claim.membershipSeasons, Number(claim.observedThrough.slice(0, 4))]) {
      if (
        !input.sourceRights.content.scope.seasonRanges.some(
          ({ from, to }) => from <= year && year <= to
        )
      )
        throw new TypeError('Player continuity years outside approved source scope.');
    }
  }
  const fieldsByNormalizedPath = new Map(
    input.sourceRights.content.fields.map((field) => [field.normalizedField, field] as const)
  );
  const requestedArchiveFields = new Set(
    input.gate0aReceipt.content.request.fieldUses
      .filter(({ use }) => use === 'archive_fact')
      .map(({ sourceField }) => sourceField)
  );
  const emittedPaths = new Set(
    input.evidence.flatMap(({ content }) => presentLeafPaths(content.claim, content.claim.kind))
  );
  const unauthorized = [...emittedPaths].filter((path) => {
    const field = fieldsByNormalizedPath.get(path);
    return (
      field === undefined ||
      field.uses.archive_fact !== 'allowed' ||
      !requestedArchiveFields.has(field.sourceField)
    );
  });
  if (unauthorized.length > 0) {
    throw new TypeError(
      `Parser emitted fields outside the reviewed Gate 0A manifest: ${unauthorized.sort().join(', ')}`
    );
  }
}
