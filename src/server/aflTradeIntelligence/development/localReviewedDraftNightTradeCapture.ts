import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalPageCapture } from '../source/externalDraftTradeIngestion';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import { REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION } from '../source/reviewedDraftNightTradeStatement';
import {
  REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER,
  reviewedDraftNightTradeStatement,
  reviewedDraftNightTradeStatements,
} from '../source/reviewedDraftNightTradeSourceScope';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

/** The governed capability id; parser v1 reads one season's reviewed statement under it. */
export const REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY = 'reviewed-draft-night-pick-trades';

/**
 * The field boundary parser v1 emits: every non-null leaf of its `transaction`,
 * `transaction_party` and `directed_transfer` claims, a slot as a `current_pick` and a later
 * season's pick as a `future_pick` (titles and native club ids are null). The recorded rights must
 * name exactly these; staging refuses a capture that emits any other leaf.
 */
export const REVIEWED_DRAFT_NIGHT_TRADES_FIELDS = [
  'directed_transfer.asset.draftType',
  'directed_transfer.asset.draftYear',
  'directed_transfer.asset.kind',
  'directed_transfer.asset.originalClub.recordedName',
  'directed_transfer.asset.recordedPickNumber',
  'directed_transfer.asset.roundNumber',
  'directed_transfer.fromClub.recordedName',
  'directed_transfer.nativeEventId',
  'directed_transfer.nativeTransferId',
  'directed_transfer.toClub.recordedName',
  'transaction.nativeEventId',
  'transaction.occurredOn',
  'transaction.seasonYear',
  'transaction.transactionType',
  'transaction_party.club.recordedName',
  'transaction_party.nativeEventId',
  'transaction_party.nativePartyId',
] as const;

/**
 * The owner records one narrow decision per season and parser version, for example
 * `reviewed-draft-night-pick-trades-issue886-private-2024-draft-night-v1`. The runner never falls
 * back to another season or parser version.
 */
export function reviewedDraftNightTradesDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION)![1]!;
  return `${REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY}-issue886-private-${season}-draft-night-${parser}`;
}

export interface LocalReviewedDraftNightTradeTarget {
  capabilityId: typeof REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY;
  season: number;
  sourceUrl: string;
  /** The season's last draft night: every deal the statement records happened by then. */
  effectiveAt: string;
}

/** The statement is effective from the season's last draft night. */
export function reviewedDraftNightTradesEffectiveAt(draftNights: readonly string[]): string {
  return `${[...draftNights].sort().at(-1)!}T00:00:00.000Z`;
}

/**
 * The registered reviewed statement of each requested season. With `urls`, only those statements:
 * each must be registered for a requested season, so a URL narrows but never widens.
 */
export function createLocalReviewedDraftNightTradeTargets(
  seasons: readonly number[],
  urls?: readonly string[]
): LocalReviewedDraftNightTradeTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Draft-night trade capture requires one or more distinct seasons.'
    );
  }
  const targets: LocalReviewedDraftNightTradeTarget[] = [...seasons]
    .sort((left, right) => left - right)
    .flatMap((season) => {
      const statements = reviewedDraftNightTradeStatements(season, 'non_production');
      if (statements.length === 0) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed draft-night trade statement is registered for ${season}.`
        );
      }
      return statements.map(({ url, draftNights }) => ({
        capabilityId: REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY,
        season,
        sourceUrl: url,
        effectiveAt: reviewedDraftNightTradesEffectiveAt(draftNights),
      }));
    });
  if (urls === undefined) return targets;
  if (urls.length === 0 || new Set(urls).size !== urls.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Draft-night statement URLs must be one or more distinct registered statements.'
    );
  }
  const unregistered = urls.filter((url) => !targets.some(({ sourceUrl }) => sourceUrl === url));
  if (unregistered.length > 0) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      `Not a registered draft-night statement of the requested seasons: ${unregistered.join(', ')}`
    );
  }
  return targets.filter(({ sourceUrl }) => urls.includes(sourceUrl));
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createReviewedDraftNightTradeCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalReviewedDraftNightTradeTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY
  ) {
    throw new TypeError('The authority is not a reviewed draft-night trade capability.');
  }
  const gateRequest = createLocalNarrowCaptureGateRequest(authority, input.target.season, {
    evaluatedAt: input.capturedAt,
  });
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER,
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      draftPathway: null,
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: REVIEWED_DRAFT_NIGHT_TRADES_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.target.effectiveAt,
      parserVersion: REVIEWED_DRAFT_NIGHT_TRADES_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}

/**
 * Reads a registered statement from the repository checkout instead of fetching its URL, and
 * refuses bytes whose sha256 is not the registered one.
 */
export async function readReviewedDraftNightTradeStatement(input: {
  url: string;
  maximumBytes: number;
  repositoryRoot: string;
}): Promise<AflTradeExternalPageCapture> {
  const registered = reviewedDraftNightTradeStatement(input.url);
  if (registered === null) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      `Not a registered draft-night statement: ${input.url}`
    );
  }
  const bytes = new Uint8Array(
    await readFile(resolve(input.repositoryRoot, registered.repositoryPath))
  );
  const contentSha256 = createHash('sha256').update(bytes).digest('hex');
  if (contentSha256 !== registered.sha256 || bytes.byteLength > input.maximumBytes) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      `${registered.repositoryPath} is not the registered statement (sha256 ${contentSha256}).`
    );
  }
  return {
    status: 'captured',
    sourceUrl: input.url,
    bytes,
    contentSha256,
    mediaType: 'application/json',
    eTag: null,
    lastModified: null,
  };
}
