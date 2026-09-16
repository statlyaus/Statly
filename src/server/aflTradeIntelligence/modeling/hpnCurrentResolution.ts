import type { AflTradeHpnPavSeasonInputSet } from './hpnPavInputContracts';
import { AflTradeHpnPavInputError } from './hpnPavInputRepository';
import { asObject, asString } from './hpnDecodedScalar';

type CurrentResolution = AflTradeHpnPavSeasonInputSet['content']['rows'][number] extends infer Row
  ? Row extends { player: infer Resolution }
    ? Resolution
    : never
  : never;
type AssignedResolution = Exclude<CurrentResolution, { assignmentDecision: null }>;

interface AflTradeHpnClubResolutionContext {
  home_club_native_id: string | null;
  home_club_name: string | null;
  away_club_native_id: string | null;
  away_club_name: string | null;
  home_club_resolutions: unknown;
  away_club_resolutions: unknown;
}

function asPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AflTradeHpnPavInputError('RESOLUTION_NOT_CURRENT', `${label} is invalid.`);
  }
  return value;
}

export function digestFromId(identifier: string, prefix: string): string {
  const match = new RegExp(`^${prefix}:([a-f0-9]{64})$`).exec(identifier);
  if (!match?.[1]) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `Current ${prefix} identity is invalid.`
    );
  }
  return match[1];
}

export function currentPlayerResolution(unparsed: unknown): CurrentResolution {
  const value = asObject(unparsed, 'player resolution');
  const decisionId = asString(value.decisionId, 'player decision');
  if (value.resolutionScope === 'candidate_only') {
    if (value.assignmentDecisionId !== null || value.assignmentStatus !== null) {
      throw new AflTradeHpnPavInputError(
        'RESOLUTION_NOT_CURRENT',
        'Candidate-only player resolution cannot claim a reusable assignment.'
      );
    }
    return {
      entityKind: 'player',
      resolutionScope: 'candidate_only',
      canonicalId: asString(value.canonicalId, 'player canonical ID'),
      revision: asPositiveInteger(value.revision, 'player revision'),
      status: 'current_approved',
      resolutionDecision: {
        id: decisionId,
        sha256: digestFromId(decisionId, 'provider-resolution-decision'),
      },
      assignmentDecision: null,
    };
  }
  return currentResolution('player', value);
}

export function currentResolution(
  entityKind: 'player' | 'club' | 'match',
  unparsed: unknown
): AssignedResolution {
  const value = asObject(unparsed, `${entityKind} resolution`);
  const decisionId = asString(value.decisionId, `${entityKind} decision`);
  const assignmentDecisionId = asString(
    value.assignmentDecisionId,
    `${entityKind} assignment decision`
  );
  if (decisionId !== assignmentDecisionId || value.assignmentStatus !== 'active') {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `The ${entityKind} resolution does not own the current active assignment.`
    );
  }
  const sha256 = digestFromId(decisionId, 'provider-resolution-decision');
  return {
    entityKind,
    canonicalId: asString(value.canonicalId, `${entityKind} canonical ID`),
    revision: asPositiveInteger(value.revision, `${entityKind} revision`),
    status: 'current_approved',
    resolutionDecision: { id: decisionId, sha256 },
    assignmentDecision: { id: assignmentDecisionId, sha256 },
  };
}

export function exactOneResolution(
  entityKind: 'club',
  unparsed: unknown,
  side: 'home' | 'away'
): AssignedResolution {
  if (!Array.isArray(unparsed) || unparsed.length !== 1) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      `The ${side}-club resolution is absent or ambiguous.`
    );
  }
  return currentResolution(entityKind, unparsed[0]);
}

export function choosePlayerClub(
  row: AflTradeHpnClubResolutionContext,
  sourceClub: unknown
): AssignedResolution {
  if (typeof sourceClub !== 'string') {
    throw new AflTradeHpnPavInputError('INCOMPLETE_SOURCE_ROWS', 'Player club is not observed.');
  }
  const home = sourceClub === row.home_club_native_id || sourceClub === row.home_club_name;
  const away = sourceClub === row.away_club_native_id || sourceClub === row.away_club_name;
  if (home === away) {
    throw new AflTradeHpnPavInputError(
      'RESOLUTION_NOT_CURRENT',
      'Player club cannot be assigned to exactly one match side.'
    );
  }
  return exactOneResolution(
    'club',
    home ? row.home_club_resolutions : row.away_club_resolutions,
    home ? 'home' : 'away'
  );
}
