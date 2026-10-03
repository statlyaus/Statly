import type { AflTradeGateDecisionProposal } from '../governance/gateDecisionTypes';
import type { AflTradeGate0ARequest } from '../source/gate0aEvaluation';
import type { AflTradeSourceRightsProposal } from '../source/sourceRights';
import { DRAFTGURU_TRADE_PERMITTED_OPERATIONS } from './localDraftguruTradeAuthorityProposal';

/** One recorded narrow issue-579 authority: its exact source rights and Gate 0A proposal. */
export interface LocalNarrowCaptureAuthority {
  readonly sourceRights: AflTradeSourceRightsProposal;
  readonly proposal: AflTradeGateDecisionProposal;
}

/**
 * The four internal operations every narrow issue-579 capture decision permits. Training, derived
 * features and public use are blocked by those decisions, so they are never requested.
 */
export const LOCAL_NARROW_CAPTURE_OPERATIONS = DRAFTGURU_TRADE_PERMITTED_OPERATIONS;

/**
 * Requests exactly what a narrow capture authority permits: the four internal operations, archive use
 * of each reviewed field, and the authority's own raw retention and cache period. The broader local
 * helpers also request training and derived-feature uses, so their requests can never pass it.
 */
export function createLocalNarrowCaptureGateRequest(
  authority: LocalNarrowCaptureAuthority,
  season: number,
  input: Readonly<{ evaluatedAt: string }>
): AflTradeGate0ARequest {
  const rights = authority.sourceRights.content;
  const range = rights.scope.seasonRanges[0]!;
  if (!Number.isSafeInteger(season) || season < range.from || season > range.to) {
    throw new TypeError(
      `The recorded ${rights.provider} authority is limited to seasons ${range.from} through ${range.to}.`
    );
  }
  return {
    decisionKey: authority.proposal.content.decisionKey,
    environment: 'non_production',
    rightsArtifactId: authority.sourceRights.rightsArtifactId,
    evaluatedAt: input.evaluatedAt,
    competition: 'AFLM',
    season,
    accessMechanism: 'automated_web',
    capabilityId: null,
    geography: 'global',
    commercialContext: 'internal-evaluation',
    audience: 'internal',
    operations: [...LOCAL_NARROW_CAPTURE_OPERATIONS],
    fieldUses: rights.fields.map(({ sourceField }) => ({
      sourceField,
      use: 'archive_fact' as const,
    })),
    rawRetentionDays: rights.retention.rawEvidence.maximumDays,
    metadataRetentionDays: null,
    cacheSeconds: rights.automatedAccess.cache.maximumSeconds,
  };
}

export class LocalExternalCaptureError extends Error {
  constructor(
    readonly code:
      'AUTHORITY_MISMATCH' | 'INVALID_TARGET' | 'ADMISSION_EXHAUSTED' | 'REQUEST_COOLDOWN',
    message: string
  ) {
    super(message);
    this.name = 'LocalExternalCaptureError';
  }
}
