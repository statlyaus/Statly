import { aflTradeFitzRoyInvocationSchema } from '../source/fitzRoyCaptureContracts';
import { parseAflTradeFitzRoyFieldMap } from '../source/fitzRoyObservationContracts';
import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from './localFiveSeasonAflTablesAuthority';

/** Raw occurrence staging only. Numerical zero provenance needs a separate exact HPN review. */
export function createLocalAflTradeAflTablesRawEvidenceFieldMap(input: {
  invocation: unknown;
  mapId: string;
  approvalDecisionId: string;
  approvedAt: string;
}) {
  const invocation = aflTradeFitzRoyInvocationSchema.parse(input.invocation);
  const original = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
  if (
    invocation.capabilityId !== 'afl-tables-player-stats' ||
    invocation.arguments.rescrape !== false
  )
    throw new TypeError(
      'Raw AFL Tables staging requires an exact full-season cache-first invocation.'
    );
  return parseAflTradeFitzRoyFieldMap({
    ...original,
    mapId: input.mapId,
    approvalDecisionId: input.approvalDecisionId,
    approvedAt: input.approvedAt,
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: invocation.authorizationSeason,
    validThroughSeason: invocation.authorizationSeason,
    // A source occurrence key is not a reusable player identity or an approved correspondence.
    naturalKeyFields: [
      'Season',
      'Round',
      'Date',
      'Home.team',
      'Away.team',
      'url',
      'First.name',
      'Surname',
      'Playing.for',
    ],
    identity: {
      ...original.identity,
      recordedName: { sourceField: 'First.name', required: true },
      recordedSurname: { sourceField: 'Surname', required: true },
      nativeId: { sourceField: 'ID', required: false },
    },
    metrics: [],
    statisticalInterpretation: 'raw_evidence_only',
    appearanceEvidence: 'requires_independent_review',
  });
}
