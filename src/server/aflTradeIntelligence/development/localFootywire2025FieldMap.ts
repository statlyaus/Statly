import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { aflTradeFitzRoyInvocationSchema } from '../source/fitzRoyCaptureContracts';
import {
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyFieldMap,
  type AflTradeFitzRoyDecodedTable,
  type AflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';

// Exact cached 2025 descriptors inspected in issue579 inspection-v4; not a flexible HTML map.
const names = [
  'Date',
  'Season',
  'Round',
  'Venue',
  'Player',
  'Team',
  'Opposition',
  'Status',
  'Match_id',
  'GA',
  'CP',
  'UP',
  'ED',
  'DE',
  'CM',
  'MI5',
  'One.Percenters',
  'BO',
  'TOG',
  'K',
  'HB',
  'D',
  'M',
  'G',
  'B',
  'T',
  'HO',
  'I50',
  'CL',
  'CG',
  'R50',
  'FF',
  'FA',
  'AF',
  'SC',
  'CCL',
  'SCL',
  'SI',
  'MG',
  'TO',
  'ITC',
  'T5',
];
const characterFields = new Set(['Round', 'Venue', 'Player', 'Team', 'Opposition', 'Status']);
export const LOCAL_FOOTYWIRE_2025_FIELD_SCHEMA: AflTradeFitzRoyDecodedTable['fields'] = names.map(
  (name) => ({
    name,
    storageType: characterFields.has(name) ? 'character' : 'double',
    classes: [name === 'Date' ? 'Date' : characterFields.has(name) ? 'character' : 'numeric'],
    levels: null,
    timezone: null,
  })
);
export const LOCAL_FOOTYWIRE_2025_SOURCE_SCHEMA_SHA256 = createDecodedFieldSchemaSha256(
  LOCAL_FOOTYWIRE_2025_FIELD_SCHEMA
);

/** Describes an exact source interpretation; the repository must authenticate the supplied review. */
export function createLocalAflTradeFootywire2025FieldMap(input: {
  invocation: unknown;
  mapId: string;
  approvalDecisionId: string;
  approvedAt: string;
}): AflTradeFitzRoyFieldMap {
  const invocation = aflTradeFitzRoyInvocationSchema.parse(input.invocation);
  if (
    invocation.capabilityId !== 'footywire-player-stats' ||
    invocation.authorizationSeason !== 2025 ||
    invocation.arguments.season !== 2025 ||
    invocation.arguments.round_number !== null ||
    invocation.arguments.check_existing !== true
  )
    throw new TypeError(
      'The FootyWire map requires the exact full-season cache-first 2025 invocation.'
    );
  return parseAflTradeFitzRoyFieldMap({
    schemaVersion: 'afl-trade-fitzroy-field-map/v1',
    mapId: input.mapId,
    capabilityId: 'footywire-player-stats',
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: LOCAL_FOOTYWIRE_2025_SOURCE_SCHEMA_SHA256,
    exactOrderedFields: [...names],
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: 2025,
    validThroughSeason: 2025,
    seasonField: { sourceField: 'Season', required: true },
    roundLabelField: { sourceField: 'Round', required: true },
    observedDateField: { sourceField: 'Date', required: true },
    naturalKeyFields: ['Match_id', 'Team', 'Player'],
    approvedAt: input.approvedAt,
    approvalDecisionId: input.approvalDecisionId,
    identity: {
      nativeId: null,
      recordedName: { sourceField: 'Player', required: true },
      recordedClubNativeId: null,
      recordedClubName: { sourceField: 'Team', required: true },
    },
    // The inspected provider parser explicitly labels the row-relative Team as Home or Away.
    // Status is orientation only, never evidence that the match was completed.
    match: {
      nativeMatchId: { sourceField: 'Match_id', required: true },
      season: { sourceField: 'Season', required: true },
      roundLabel: { sourceField: 'Round', required: true },
      matchDate: { sourceField: 'Date', required: true },
      homeClubNativeId: null,
      homeClubName: { sourceField: 'Team', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'Opposition', required: true },
      status: null,
      rowClubOrientation: {
        sourceField: 'Status',
        required: true,
        homeValue: 'Home',
        awayValue: 'Away',
      },
    },
    // Provider rows include unused substitutes; row presence does not prove participation.
    appearanceEvidence: 'requires_independent_review',
    metrics: [
      {
        metricCode: 'goals',
        sourceField: 'G',
        definitionVersion: 'goals/v1',
        unit: 'goals',
        zeroSemantics: 'measured_zero',
      },
    ],
    achievement: null,
  });
}
