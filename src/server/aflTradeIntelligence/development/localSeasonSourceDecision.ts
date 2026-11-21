import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '../governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceRights';

export interface SeasonSourceDecisionRecords {
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
}

export interface SeasonSourceDecisionInput {
  /** The effective narrow decision for an earlier season, with its proposal and source rights. */
  predecessor: SeasonSourceDecisionRecords;
  decisionKey: string;
  season: number;
  approvalArtifactId: string;
  decidedAt: string;
  revalidateAt: string;
  /**
   * The parser the runner reads `season` at, when it differs from the predecessor's (for example
   * `draftguru-national-year-page/v8` for 2026 from a v3 predecessor). Omitted, the parser is kept.
   */
  parserVersion?: string;
}

// A four-digit year that is not part of an id, a date (2025-10-12) or a hyphenated key (...-2025).
const STANDALONE_YEAR = /(?<![0-9A-Za-z-])(\d{4})(?![0-9A-Za-z]|-\d)/gu;
const ANY_YEAR = /(?<![0-9A-Za-z])(\d{4})(?![0-9A-Za-z])/gu;
// A year range such as 2011-2015 or 2011–2015, which the standalone-year rewrite leaves alone.
const YEAR_RANGE = /(?<![0-9A-Za-z])(\d{4})\s*[-–]\s*(\d{4})(?![0-9A-Za-z])/gu;

function rewriteSeasonText(text: string, from: number, to: number, season: number): string {
  let rewritten = text;
  for (const range of [
    `${from}-${to}`,
    `${from}–${to}`,
    `${from} through ${to}`,
    `${from} to ${to}`,
  ]) {
    rewritten = rewritten.split(range).join(String(season));
  }
  return rewritten.replace(STANDALONE_YEAR, (year) =>
    Number(year) >= from && Number(year) <= to ? String(season) : year
  );
}

const PARSER_VERSION = /^[a-z0-9-]+\/(v[1-9]\d*)$/u;

/**
 * The predecessor's parser and the rewrite that replaces it, when the derived decision changes it:
 * the full version everywhere (the rights' `clientVersion` among them) and `parser v3` in prose. Ids
 * and keys such as `-parser-v3` stay as recorded.
 */
function parserChange(rights: AflTradeSourceRightsProposal, to: string | undefined) {
  const { acquisition } = rights.content;
  const from = 'clientVersion' in acquisition ? acquisition.clientVersion : null;
  if (to === undefined || to === from) return null;
  const fromShort = PARSER_VERSION.exec(from ?? '')?.[1];
  const toShort = PARSER_VERSION.exec(to)?.[1];
  if (from === null || fromShort === undefined || toShort === undefined) {
    throw new TypeError(
      `Only a <name>/v<n> parser can be replaced by another: ${from ?? 'no parser'} to ${to}.`
    );
  }
  // `parser v3` in prose, never `parser v30` or `parser v3.1`.
  const short = new RegExp(`(?<![\\w-])(parser )${fromShort}(?!\\w|\\.\\d)`, 'giu');
  return {
    from,
    to,
    rewrite: (text: string) => text.split(from).join(to).replace(short, `$1${toShort}`),
  };
}

function rewriteStrings<T>(value: T, rewrite: (text: string) => string): T {
  if (typeof value === 'string') return rewrite(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => rewriteStrings(item, rewrite)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteStrings(item, rewrite)])
    ) as T;
  }
  return value;
}

/** Years of the predecessor's range, other than the new season, still named in the proposal. */
export function predecessorSeasonTraces(
  proposal: AflTradeGateDecisionProposal,
  predecessorRange: { from: number; to: number },
  season: number
): number[] {
  const content = JSON.stringify({ ...proposal.content, proposedAt: null });
  const years = [...content.matchAll(ANY_YEAR)].map(([year]) => Number(year));
  return [
    ...new Set(
      years.filter(
        (year) => year >= predecessorRange.from && year <= predecessorRange.to && year !== season
      )
    ),
  ].sort((left, right) => left - right);
}

/**
 * Predecessor years left in the derived source rights. Dates (2025-10-12) are terms and stay; a
 * standalone year or either end of a year range inside the predecessor's range is a trace.
 */
function rightsSeasonTraces(
  rights: AflTradeSourceRightsProposal,
  predecessorRange: { from: number; to: number },
  season: number
): number[] {
  const content = JSON.stringify({ ...rights.content, proposedAt: null });
  const years = [
    ...[...content.matchAll(STANDALONE_YEAR)].map(([year]) => Number(year)),
    ...[...content.matchAll(YEAR_RANGE)].flatMap(([, from, to]) => [Number(from), Number(to)]),
  ];
  return [
    ...new Set(
      years.filter(
        (year) => year >= predecessorRange.from && year <= predecessorRange.to && year !== season
      )
    ),
  ].sort((left, right) => left - right);
}

/**
 * Derives a version-1 narrow decision for one season from the effective decision for an earlier
 * season: the same provider, parser, pacing, cache, retention and conditions, the season range
 * narrowed to the one season, and every predecessor year and rights id rewritten out of the
 * proposal. With `parserVersion`, the predecessor's parser is rewritten to it in the rights and the
 * proposal (see {@link parserChange}). The decision cites the owner's stored approval and the predecessor's condition evidence.
 * It is never a successor: a successor on the predecessor's key would make every retained target
 * bound to it non-current (migration 0161).
 */
export function deriveSeasonSourceDecision(
  input: SeasonSourceDecisionInput
): SeasonSourceDecisionRecords {
  const { predecessor, season } = input;
  const ranges = predecessor.sourceRights.content.scope.seasonRanges;
  if (ranges.length !== 1) {
    throw new TypeError('The predecessor source rights must record exactly one season range.');
  }
  const range = ranges[0]!;
  if (season >= range.from && season <= range.to) {
    throw new TypeError(`The predecessor already covers ${season}.`);
  }
  const parser = parserChange(predecessor.sourceRights, input.parserVersion);
  const rewrite = (text: string) => {
    const seasonText = rewriteSeasonText(text, range.from, range.to, season);
    return parser === null ? seasonText : parser.rewrite(seasonText);
  };

  const rightsContent = {
    ...rewriteStrings(predecessor.sourceRights.content, rewrite),
    scope: {
      ...predecessor.sourceRights.content.scope,
      seasonRanges: [{ from: season, to: season }],
    },
    proposedAt: input.decidedAt,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });

  const rightsTraces = rightsSeasonTraces(sourceRights, range, season);
  if (rightsTraces.length > 0) {
    throw new TypeError(
      `The derived source rights still name predecessor years ${rightsTraces.join(', ')}; record reviewed rights instead.`
    );
  }

  const predecessorRightsId = predecessor.sourceRights.rightsArtifactId;
  const rewrittenProposal = rewriteStrings(predecessor.proposal.content, rewrite);
  const dimensionNames = rewrittenProposal.scope.dimensions.map(({ name }) => name);
  if (!dimensionNames.includes('season') || !dimensionNames.includes('source_rights_artifact')) {
    throw new TypeError('The predecessor proposal must scope a season and a source-rights record.');
  }
  const proposalContent = {
    ...rewrittenProposal,
    decisionKey: input.decisionKey,
    version: 1,
    scope: {
      ...rewrittenProposal.scope,
      scopeKey: input.decisionKey,
      dimensions: rewrittenProposal.scope.dimensions.map((dimension) =>
        dimension.name === 'season'
          ? { ...dimension, values: [String(season)] }
          : dimension.name === 'source_rights_artifact'
            ? { ...dimension, values: [sourceRights.rightsArtifactId] }
            : dimension
      ),
    },
    affectedArtifacts: rewrittenProposal.affectedArtifacts.map((artifact) =>
      artifact.kind === 'source_rights' && artifact.artifactId === predecessorRightsId
        ? { ...artifact, artifactId: sourceRights.rightsArtifactId }
        : artifact
    ),
    proposedAt: input.decidedAt,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const traces = predecessorSeasonTraces(proposal, range, season);
  if (traces.length > 0 || JSON.stringify(proposal.content).includes(predecessorRightsId)) {
    throw new TypeError(
      `The derived proposal still names predecessor ${traces.length > 0 ? `years ${traces.join(', ')}` : 'source rights'}; record a reviewed proposal instead.`
    );
  }

  const predecessorResults = new Map(
    predecessor.decision.content.conditionResults.map((result) => [result.conditionId, result])
  );
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: proposal.content.environment,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: proposal.content.accountableOwner,
    decidedBy: predecessor.decision.content.decidedBy,
    reviewers: [],
    authorityEvidenceIds: [input.approvalArtifactId],
    conditionResults: proposal.content.conditions.map(({ conditionId }) => {
      const carried = predecessorResults.get(conditionId);
      if (carried === undefined || carried.status !== 'satisfied') {
        throw new TypeError(`The predecessor decision did not satisfy condition ${conditionId}.`);
      }
      return {
        conditionId,
        status: 'satisfied' as const,
        evidenceIds: carried.evidenceIds,
        explanation: `Satisfied for ${season} on the evidence decision ${predecessor.decision.decisionId} cited, under owner approval ${input.approvalArtifactId}.`,
      };
    }),
    rationale: `Owner approval ${input.approvalArtifactId} extends the ${predecessor.decision.content.decisionKey} authority to ${season} as its own version-1 decision${parser === null ? '' : ` at parser ${parser.to} (the predecessor's was ${parser.from})`}.`,
    limitations: [...proposal.content.scope.exclusions],
    decidedAt: input.decidedAt,
    effectiveAt: input.decidedAt,
    revalidateAt: input.revalidateAt,
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { sourceRights, proposal, decision };
}

/** Every `artifact:` reference the proposal and decision cite (migration 0253's set). */
export function citedGateArtifactIds(
  proposal: AflTradeGateDecisionProposal,
  decision: AflTradeGateDecisionRecord
): string[] {
  const cited = [
    ...proposal.content.evidenceIds,
    ...proposal.content.conditions.flatMap(
      ({ verificationEvidenceIds }) => verificationEvidenceIds
    ),
    ...decision.content.authorityEvidenceIds,
    ...decision.content.conditionResults.flatMap(({ evidenceIds }) => evidenceIds),
    ...decision.content.reviewers.map(({ evidenceId }) => evidenceId),
  ];
  return [...new Set(cited.filter((id) => id.startsWith('artifact:')))].sort();
}
