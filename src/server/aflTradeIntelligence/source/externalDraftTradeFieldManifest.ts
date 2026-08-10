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
