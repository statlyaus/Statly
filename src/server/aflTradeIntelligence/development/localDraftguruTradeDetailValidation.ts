import { createHash } from 'node:crypto';

import {
  parseDraftguruTradeDetail,
  type DraftguruTradeParseResult,
} from '../source/draftguruSourceAdapter';

/** One `detail-cache.json` entry: a captured trade-detail response and the hash that identifies it. */
export interface DraftguruTradeDetailCacheEntry {
  readonly url: string;
  readonly sha256: string;
  readonly bodyFile: string;
  readonly recordedAt: string;
  readonly authority: string;
  readonly factsValidated: boolean;
}

export interface DraftguruTradeDetailValidationOutcome {
  readonly eventId: string;
  readonly bodyShaMatches: boolean;
  readonly parsed: DraftguruTradeParseResult | null;
  readonly issues: readonly { code: string; detail: string }[];
  readonly parties: readonly string[];
  readonly assetKinds: readonly string[];
  readonly transfers: readonly {
    readonly nativeTransferId: string;
    readonly fromClub: string;
    readonly toClub: string;
    readonly assetSignature: string;
  }[];
  /** Whether the captured page states an exact calendar date anywhere. */
  readonly statesExplicitDate: boolean;
}

const DATE_PATTERN = /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/u;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Recursively key-sorted JSON, so two equal assets always serialise identically. */
export function canonicalAssetJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item as Record<string, unknown>)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]])
        )
      : item
  );
}

export function draftguruEventIdFromUrl(url: string): string | null {
  return /\/trades\/([^/]+)$/u.exec(new URL(url).pathname)?.[1] ?? null;
}

type DirectedTransferClaim = Readonly<{
  kind: 'directed_transfer';
  nativeTransferId: string;
  fromClub: Readonly<{ recordedName: string }>;
  toClub: Readonly<{ recordedName: string }>;
  asset: unknown;
}>;

type TransactionPartyClaim = Readonly<{ kind: 'transaction_party'; club: { recordedName: string } }>;

function isDirectedTransfer(claim: unknown): claim is DirectedTransferClaim {
  const candidate = claim as Partial<DirectedTransferClaim> | null;
  return (
    candidate?.kind === 'directed_transfer' &&
    typeof candidate.nativeTransferId === 'string' &&
    typeof candidate.fromClub?.recordedName === 'string' &&
    typeof candidate.toClub?.recordedName === 'string' &&
    candidate.asset !== undefined
  );
}

function isTransactionParty(claim: unknown): claim is TransactionPartyClaim {
  const candidate = claim as Partial<TransactionPartyClaim> | null;
  return candidate?.kind === 'transaction_party' && typeof candidate.club?.recordedName === 'string';
}

/**
 * Validates one captured Draftguru trade-detail body against the parser the pipeline itself uses.
 *
 * The capture is public inspection evidence, and the parser reports `occurredOn: null` for every
 * trade because the source records only a season. This validation therefore reports whether a date
 * exists rather than inventing one: `effectiveAt` is passed as a parser argument only, and is derived
 * from the season so the call is deterministic.
 */
export function validateDraftguruTradeDetail(input: {
  readonly entry: DraftguruTradeDetailCacheEntry;
  readonly html: string;
}): DraftguruTradeDetailValidationOutcome | null {
  const eventId = draftguruEventIdFromUrl(input.entry.url);
  if (eventId === null) return null;
  const seasonYear = Number.parseInt(eventId.slice(0, 4), 10);
  if (!Number.isInteger(seasonYear) || seasonYear < 1988 || seasonYear > 2200) return null;
  const nominalSeasonInstant = `${seasonYear}-10-01T00:00:00.000Z`;
  const parsed = parseDraftguruTradeDetail(input.html, {
    capture: {
      captureId: `source-capture:${input.entry.sha256}`,
      artifactId: `artifact:${input.entry.sha256}`,
      contentSha256: input.entry.sha256,
      mediaType: 'text/html; charset=utf-8',
      sourceUrl: input.entry.url,
      // The cache records microseconds with an offset; the capture contract requires milliseconds in Z.
      capturedAt: new Date(input.entry.recordedAt).toISOString(),
      effectiveAt: nominalSeasonInstant,
      parserVersion: 'draftguru-trade-parser/v1',
      fieldManifestSha256: sha256('statly-draftguru-detail-validation'),
    },
    draftYear: seasonYear,
    effectiveAt: nominalSeasonInstant,
  });

  const parties: string[] = [];
  const assetKinds: string[] = [];
  const transfers: DraftguruTradeDetailValidationOutcome['transfers'][number][] = [];
  for (const row of parsed.evidence) {
    const claim: unknown = row.content.claim;
    if (isTransactionParty(claim) && !parties.includes(claim.club.recordedName)) {
      parties.push(claim.club.recordedName);
      continue;
    }
    if (!isDirectedTransfer(claim)) continue;
    assetKinds.push((claim.asset as { kind: string }).kind);
    transfers.push({
      nativeTransferId: claim.nativeTransferId,
      fromClub: claim.fromClub.recordedName,
      toClub: claim.toClub.recordedName,
      assetSignature: canonicalAssetJson(claim.asset),
    });
  }

  return {
    eventId,
    bodyShaMatches: sha256(input.html) === input.entry.sha256,
    parsed,
    issues: parsed.issues.map((issue) => ({ code: issue.code, detail: issue.detail })),
    parties,
    assetKinds,
    transfers,
    statesExplicitDate: DATE_PATTERN.test(input.html),
  };
}

/**
 * The trace expresses `player`, `current_pick_entitlement` and `future_pick_entitlement`, so any other
 * source asset kind cannot be carried into a constructed trade without widening that vocabulary.
 */
export const DRAFTGURU_TO_TRACE_ASSET_KINDS: Readonly<Record<string, string | null>> = {
  player: 'player',
  current_pick: 'current_pick_entitlement',
  future_pick: 'future_pick_entitlement',
  special_pick: null,
};

export interface DraftguruTradeDetailValidationSummary {
  readonly entries: number;
  readonly unparsableEntries: number;
  readonly hashMismatches: number;
  readonly parsedWithoutIssues: number;
  readonly issues: Readonly<Record<string, number>>;
  readonly assetKinds: Readonly<Record<string, number>>;
  readonly unexpressibleAssetKindCount: number;
  readonly transferCount: number;
  readonly partyDistribution: string;
  readonly duplicateTransferIds: readonly string[];
  readonly withinEventDuplicates: readonly string[];
  readonly crossEventDuplicateGroups: readonly (readonly string[])[];
  readonly tradesWithExplicitDate: readonly string[];
}

/** Aggregates per-body outcomes. Pure, so the measurements can be asserted without the capture. */
export function summariseDraftguruTradeDetailValidation(
  outcomes: readonly (DraftguruTradeDetailValidationOutcome | null)[]
): DraftguruTradeDetailValidationSummary {
  const issues: Record<string, number> = {};
  const assetKinds: Record<string, number> = {};
  const partyCounts = new Map<number, number>();
  const duplicateTransferIds: string[] = [];
  const withinEventDuplicates: string[] = [];
  const tradesWithExplicitDate: string[] = [];
  const signatureSets = new Map<string, string[]>();
  let transferCount = 0;
  let parsedWithoutIssues = 0;
  let unexpressible = 0;

  for (const outcome of outcomes) {
    if (outcome === null) continue;
    for (const issue of outcome.issues) issues[issue.code] = (issues[issue.code] ?? 0) + 1;
    if (outcome.issues.length === 0) parsedWithoutIssues += 1;
    for (const kind of outcome.assetKinds) {
      assetKinds[kind] = (assetKinds[kind] ?? 0) + 1;
      if (DRAFTGURU_TO_TRACE_ASSET_KINDS[kind] === null) unexpressible += 1;
    }
    transferCount += outcome.transfers.length;
    if (outcome.parties.length > 0) {
      partyCounts.set(outcome.parties.length, (partyCounts.get(outcome.parties.length) ?? 0) + 1);
    }
    if (outcome.statesExplicitDate) tradesWithExplicitDate.push(outcome.eventId);

    const seenIds = new Set<string>();
    const signatures: string[] = [];
    for (const transfer of outcome.transfers) {
      if (seenIds.has(transfer.nativeTransferId)) {
        duplicateTransferIds.push(`${outcome.eventId}:${transfer.nativeTransferId}`);
      }
      seenIds.add(transfer.nativeTransferId);
      const signature = `${transfer.fromClub}|${transfer.toClub}|${transfer.assetSignature}`;
      if (signatures.includes(signature)) withinEventDuplicates.push(`${outcome.eventId}:${signature}`);
      signatures.push(signature);
    }
    if (signatures.length > 0) {
      const key = [...signatures].sort().join(' || ');
      signatureSets.set(key, [...(signatureSets.get(key) ?? []), outcome.eventId]);
    }
  }

  const crossEventDuplicateGroups = [...signatureSets.values()]
    .filter((eventIds) => eventIds.length > 1)
    .map((eventIds) => [...eventIds].sort());

  return {
    entries: outcomes.filter((outcome) => outcome !== null).length,
    unparsableEntries: outcomes.filter((outcome) => outcome === null).length,
    hashMismatches: outcomes.filter((outcome) => outcome !== null && !outcome.bodyShaMatches).length,
    parsedWithoutIssues,
    issues,
    assetKinds,
    unexpressibleAssetKindCount: unexpressible,
    transferCount,
    partyDistribution: [...partyCounts]
      .sort((left, right) => left[0] - right[0])
      .map(([partyCount, trades]) => `${partyCount}:${trades}`)
      .join(' '),
    duplicateTransferIds,
    withinEventDuplicates,
    crossEventDuplicateGroups,
    tradesWithExplicitDate,
  };
}
