import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import {
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
  reviewedOfficialAflDraftSessionPages,
} from '../source/officialAflDraftSessionAdapter';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

export const OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY = 'official-afl-completed-draft-session';

/**
 * The owner records one narrow decision per season and parser version for this capability, for
 * example `official-afl-completed-draft-session-issue579-private-2020-session-v18`. A new parser
 * version therefore needs its own recorded decision; the runner never falls back to an earlier one.
 */
export function officialAflDraftSessionDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION)![1]!;
  return `${OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY}-issue579-private-${season}-session-${parser}`;
}

export interface LocalOfficialAflDraftSessionTarget {
  capabilityId: typeof OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY;
  season: number;
  sourceUrl: string;
  /** The completed date the reviewed page reports; the claims are effective from that day. */
  effectiveAt: string;
}

/** Every exact reviewed completed-session page for each requested season, in session order. */
export function createLocalOfficialAflDraftSessionTargets(
  seasons: readonly number[]
): LocalOfficialAflDraftSessionTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Completed-session capture requires one or more distinct seasons.'
    );
  }
  return [...seasons]
    .sort((left, right) => left - right)
    .flatMap((season) => {
      const pages = reviewedOfficialAflDraftSessionPages(season);
      if (pages.length === 0) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed Official AFL completed-session page is enumerable for ${season}.`
        );
      }
      return pages.map(({ url, completedOn }) => ({
        capabilityId: OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY,
        season,
        sourceUrl: url,
        effectiveAt: `${completedOn}T00:00:00.000Z`,
      }));
    });
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createOfficialAflDraftSessionCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalOfficialAflDraftSessionTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'official_afl' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY
  ) {
    throw new TypeError('The authority is not an Official AFL completed-session capability.');
  }
  const gateRequest = createLocalNarrowCaptureGateRequest(authority, input.target.season, {
    evaluatedAt: input.capturedAt,
  });
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'official_afl',
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      // Every enumerable reviewed completed-session page reports the national draft.
      draftPathway: 'national',
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.target.effectiveAt,
      parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
