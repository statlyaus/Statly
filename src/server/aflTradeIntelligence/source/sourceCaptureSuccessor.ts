import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
} from './externalDraftTradeEvidenceContracts';

/**
 * Successors for lost source captures (migration 0252). A lost capture's bytes are gone, but the
 * claims its parser produced survive in its evidence batch. A fresh capture of the same source may
 * stand in for it only when every one of those claims reappears verbatim in the fresh capture's
 * batch. Per-capture fields (the capture block, ordinals, source keys, evidence IDs) are not facts
 * and are not compared. A newer parser may emit additional claims; they are reported but do not
 * block. Anything missing or changed refuses the successor, for the owner to review.
 */

export const SOURCE_CAPTURE_SUCCESSOR_SCHEMA_VERSION = 'afl-trade-source-capture-successor/v1';
export const SOURCE_CAPTURE_SUCCESSOR_REVIEWER =
  'owner-delegated-technical-reviewer:capture-successor-rule/v1';

export interface SourceCaptureClaimComparison {
  readonly matches: boolean;
  readonly lostClaims: number;
  readonly freshClaims: number;
  /** Canonical JSON of every lost claim with no remaining verbatim counterpart in the fresh batch. */
  readonly missing: readonly string[];
  /** Fresh claims left over after every lost claim was matched. */
  readonly additional: number;
}

function claimKeys(batch: AflTradeExternalEvidenceBatch): string[] {
  return batch.content.evidence.map((evidence) => canonicalizeAflTradeJson(evidence.content.claim));
}

/** Compares claims as a multiset, so a claim stated twice must reappear twice. */
export function compareSourceCaptureClaims(
  lostInput: unknown,
  freshInput: unknown
): SourceCaptureClaimComparison {
  const lost = parseAflTradeExternalEvidenceBatch(lostInput);
  const fresh = parseAflTradeExternalEvidenceBatch(freshInput);
  if (lost.content.provider !== fresh.content.provider) {
    throw new TypeError('A successor batch must come from the same provider as the lost batch.');
  }
  const remaining = new Map<string, number>();
  for (const key of claimKeys(fresh)) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const missing: string[] = [];
  for (const key of claimKeys(lost)) {
    const count = remaining.get(key) ?? 0;
    if (count === 0) missing.push(key);
    else remaining.set(key, count - 1);
  }
  const additional = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  return {
    matches: missing.length === 0,
    lostClaims: lost.content.evidence.length,
    freshClaims: fresh.content.evidence.length,
    missing,
    additional,
  };
}

export type SourceCaptureSuccessorInput =
  | {
      kind: 'recaptured';
      lostArtifactId: string;
      successorCaptureId: string;
      successorArtifactId: string;
      createdAt: string;
    }
  | { kind: 'omitted'; lostArtifactId: string; createdAt: string };

export interface SourceCaptureSuccessorRecord {
  readonly successorId: string;
  readonly record: {
    readonly schemaVersion: typeof SOURCE_CAPTURE_SUCCESSOR_SCHEMA_VERSION;
    readonly kind: 'recaptured' | 'omitted';
    readonly lostArtifactId: string;
    readonly successorCaptureId: string | null;
    readonly successorArtifactId: string | null;
    readonly createdAt: string;
  };
}

/** The exact, content-addressed record the 0252 guard requires. */
export function createSourceCaptureSuccessorRecord(
  input: SourceCaptureSuccessorInput
): SourceCaptureSuccessorRecord {
  if (input.kind === 'recaptured' && input.successorArtifactId === input.lostArtifactId) {
    throw new TypeError('A recaptured successor must cite different bytes from the lost capture.');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt)) {
    throw new TypeError('A successor record needs a UTC millisecond instant.');
  }
  const record = {
    schemaVersion: SOURCE_CAPTURE_SUCCESSOR_SCHEMA_VERSION,
    kind: input.kind,
    lostArtifactId: input.lostArtifactId,
    successorCaptureId: input.kind === 'recaptured' ? input.successorCaptureId : null,
    successorArtifactId: input.kind === 'recaptured' ? input.successorArtifactId : null,
    createdAt: input.createdAt,
  } as const;
  return { successorId: createAflTradeContentAddress('source-capture-successor', record), record };
}

/** The decision rationale: the match summary, or the owner decision that authorised an omission. */
export function describeSourceCaptureSuccessorDecision(
  input:
    | { kind: 'recaptured'; comparison: SourceCaptureClaimComparison }
    | { kind: 'omitted'; ownerDecisionRef: string }
): string {
  if (input.kind === 'omitted') {
    return `Omitted under owner decision ${input.ownerDecisionRef}; no successor capture is cited.`;
  }
  const c = input.comparison;
  if (!c.matches) throw new TypeError('A refused comparison has no approval rationale.');
  return (
    `Approved by ${SOURCE_CAPTURE_SUCCESSOR_REVIEWER}: all ${c.lostClaims} recorded claims of the ` +
    `lost capture reappear verbatim among ${c.freshClaims} claims of the fresh capture` +
    (c.additional > 0 ? `; ${c.additional} additional claim(s) reported, not relied on.` : '.')
  );
}
