import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  isLocalExternalCaptureCapability,
  LocalExternalCaptureError,
  loadRecordedLocalCaptureAuthority,
  localExternalCaptureDecisionKey,
  localExternalCaptureParserVersion,
  type LocalExternalCaptureCapability,
} from '../src/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import {
  citedGateArtifactIds,
  deriveSeasonSourceDecision,
} from '../src/server/aflTradeIntelligence/development/localSeasonSourceDecision';
import {
  AflTradeArtifactUnlocatedError,
  requireAflTradeEvidenceLocated,
} from '../src/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { appendAflTradeGateDecision } from '../src/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  createPostgresAflTradeGateDecisionLedgerRepository,
  type AflTradeGateDecisionLedgerRepository,
} from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeSourceRightsProposal } from '../src/server/aflTradeIntelligence/source/sourceRights';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Records the owner's approval of one capture capability for one new season as its own version-1
 * narrow decision, derived from the effective decision for an earlier season. Never a successor: a
 * successor on the earlier key would make every retained target bound to it non-current. A dry run
 * is the default and writes nothing. See the runbook section "Recording a season's source decision".
 *
 * Usage:
 *   npm run outcomes:sources:record-season-decision -- --capability <id> --season <year> \
 *     --from-season <year> --approval-artifact <artifact:...> --decided-at <iso> \
 *     --revalidate-at <iso> [--parser-version <name>/v<n>] [--apply]
 *
 * `--parser-version` records the runner's parser for `--season` when it differs from the
 * predecessor's (for example `draftguru-national-year-page/v8` for 2026); any other value is refused.
 */

const VALUE_OPTIONS = new Set([
  '--capability',
  '--season',
  '--from-season',
  '--approval-artifact',
  '--decided-at',
  '--revalidate-at',
  '--parser-version',
]);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Recording a season's source decision".`);
}

export interface SeasonSourceDecisionArguments {
  databaseUrl: string;
  capabilityId: LocalExternalCaptureCapability;
  season: number;
  fromSeason: number;
  approvalArtifactId: string;
  decidedAt: string;
  revalidateAt: string;
  /** The runner's parser for `season`, when it differs from the predecessor's. */
  parserVersion?: string;
  apply: boolean;
}

export function parseSeasonSourceDecisionArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): SeasonSourceDecisionArguments {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (name === '--apply' && !apply) {
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!VALUE_OPTIONS.has(name) || value === undefined || value.startsWith('--')) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
    index += 1;
  }
  const capabilityId = values.get('--capability');
  if (!isLocalExternalCaptureCapability(capabilityId)) {
    usage('--capability must name a local capture capability.');
  }
  const year = (name: string) => {
    const value = Number(values.get(name));
    if (!Number.isInteger(value) || value < 1897 || value > 2200) usage(`${name} must be a year.`);
    return value;
  };
  const instant = (name: string) => {
    const value = values.get(name);
    if (value === undefined || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
      usage(`${name} must be a UTC millisecond instant.`);
    }
    return value;
  };
  const approvalArtifactId = values.get('--approval-artifact');
  if (approvalArtifactId === undefined || !/^artifact:[0-9a-f]{64}$/u.test(approvalArtifactId)) {
    usage('--approval-artifact must be the stored approval record artifact ID.');
  }
  const parserVersion = values.get('--parser-version');
  if (parserVersion !== undefined && !/^[a-z0-9-]+\/v[1-9]\d*$/u.test(parserVersion)) {
    usage('--parser-version must be a parser version such as draftguru-national-year-page/v8.');
  }
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    capabilityId,
    season: year('--season'),
    fromSeason: year('--from-season'),
    approvalArtifactId,
    decidedAt: instant('--decided-at'),
    revalidateAt: instant('--revalidate-at'),
    ...(parserVersion === undefined ? {} : { parserVersion }),
    apply,
  };
}

export type SeasonSourceDecisionOutcome =
  | {
      status: 'refused';
      reason:
        | 'REVALIDATE_NOT_FUTURE'
        | 'DECISION_KEY_EXISTS'
        | 'PREDECESSOR_UNAVAILABLE'
        | 'PARSER_NOT_RUNNER'
        | 'DERIVATION_REFUSED'
        | 'INVALID_APPEND'
        | 'RUNNER_WOULD_REFUSE'
        | 'ARTIFACT_UNLOCATED';
      message: string;
      unlocatedArtifactIds?: readonly string[];
    }
  | {
      status: 'dry_run' | 'recorded';
      predecessorDecisionId: string;
      decisionId: string;
      proposalId: string;
      rightsArtifactId: string;
      revalidateAt: string;
      termsExpireAt: string | null;
      /** Dry run only: the derived records, for the owner to read before they are written. */
      derived?: Readonly<{ sourceRights: unknown; proposal: unknown; decision: unknown }>;
    };

function refused(
  reason: Extract<SeasonSourceDecisionOutcome, { status: 'refused' }>['reason'],
  error: unknown
): SeasonSourceDecisionOutcome {
  return { status: 'refused', reason, message: error instanceof Error ? error.message : reason };
}

async function unlocatedArtifactIds(
  sql: AflOutcomeSqlClient,
  artifactIds: readonly string[]
): Promise<readonly string[]> {
  try {
    await sql.transaction((transaction) =>
      requireAflTradeEvidenceLocated(transaction, artifactIds)
    );
    return [];
  } catch (error) {
    if (error instanceof AflTradeArtifactUnlocatedError) return error.artifactIds;
    throw error;
  }
}

/**
 * The parser is the runner's for --season: named with --parser-version, or else the predecessor's.
 * Returns the refusal when it is not, else null.
 */
function refuseUnlessRunnerParser(
  parsed: Pick<SeasonSourceDecisionArguments, 'season' | 'parserVersion'>,
  predecessorRights: AflTradeSourceRightsProposal,
  runnerParser: string
): SeasonSourceDecisionOutcome | null {
  const { acquisition } = predecessorRights.content;
  const parserVersion =
    parsed.parserVersion ?? ('clientVersion' in acquisition ? acquisition.clientVersion : null);
  if (parserVersion === runnerParser) return null;
  return refused(
    'PARSER_NOT_RUNNER',
    new Error(
      parsed.parserVersion === undefined
        ? `The runner reads ${parsed.season} at ${runnerParser}, not the predecessor's ${parserVersion ?? 'parser'}; pass --parser-version ${runnerParser}.`
        : `--parser-version must be ${runnerParser}, the parser the runner reads ${parsed.season} at.`
    )
  );
}

export async function recordSeasonSourceDecision(
  sql: AflOutcomeSqlClient,
  parsed: Omit<SeasonSourceDecisionArguments, 'databaseUrl'>,
  now: () => string = () => new Date().toISOString()
): Promise<SeasonSourceDecisionOutcome> {
  const evaluatedAt = now();
  if (Date.parse(parsed.revalidateAt) <= Date.parse(evaluatedAt)) {
    return refused('REVALIDATE_NOT_FUTURE', new Error('--revalidate-at must be in the future.'));
  }
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  const stored = await ledger.load();
  const decisionKey = localExternalCaptureDecisionKey(parsed.capabilityId, parsed.season);
  if (stored.ledger.proposals.some(({ content }) => content.decisionKey === decisionKey)) {
    return refused(
      'DECISION_KEY_EXISTS',
      new Error(`${decisionKey} already has a decision; this command never records a successor.`)
    );
  }

  let predecessor: Awaited<ReturnType<typeof loadRecordedLocalCaptureAuthority>>;
  try {
    predecessor = await loadRecordedLocalCaptureAuthority(
      ledger,
      parsed.capabilityId,
      parsed.fromSeason,
      evaluatedAt
    );
  } catch (error) {
    if (!(error instanceof LocalExternalCaptureError)) throw error;
    return refused('PREDECESSOR_UNAVAILABLE', error);
  }
  const predecessorDecision = stored.ledger.decisions.find(
    ({ decisionId }) => decisionId === predecessor.decisionId
  );
  if (predecessorDecision === undefined) {
    return refused('PREDECESSOR_UNAVAILABLE', new Error('The Gate ledger changed while loading.'));
  }
  const runnerParser = localExternalCaptureParserVersion(parsed.capabilityId, parsed.season);
  const parserRefusal = refuseUnlessRunnerParser(
    parsed,
    predecessor.authority.sourceRights,
    runnerParser
  );
  if (parserRefusal !== null) return parserRefusal;
  let derived: ReturnType<typeof deriveSeasonSourceDecision>;
  try {
    derived = deriveSeasonSourceDecision({
      predecessor: { ...predecessor.authority, decision: predecessorDecision },
      decisionKey,
      season: parsed.season,
      approvalArtifactId: parsed.approvalArtifactId,
      decidedAt: parsed.decidedAt,
      revalidateAt: parsed.revalidateAt,
      parserVersion: runnerParser,
    });
  } catch (error) {
    return refused('DERIVATION_REFUSED', error);
  }

  let appended: ReturnType<typeof appendAflTradeGateDecision>;
  try {
    appended = appendAflTradeGateDecision(stored.ledger, derived.proposal, derived.decision);
  } catch (error) {
    return refused('INVALID_APPEND', error);
  }
  // The runner must accept the derived records before anything is written.
  const preview: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'resolveAuthorization'> = {
    load: async () => ({ revision: stored.revision + 1, ledger: appended }),
    resolveAuthorization: async (rightsArtifactId) =>
      rightsArtifactId === derived.sourceRights.rightsArtifactId
        ? { revision: stored.revision + 1, ledger: appended, sourceRights: derived.sourceRights }
        : ledger.resolveAuthorization(rightsArtifactId),
  };
  try {
    await loadRecordedLocalCaptureAuthority(
      preview,
      parsed.capabilityId,
      parsed.season,
      evaluatedAt
    );
  } catch (error) {
    return refused('RUNNER_WOULD_REFUSE', error);
  }
  // Migration 0253 refuses a record citing evidence without a custody location.
  const unlocated = await unlocatedArtifactIds(
    sql,
    citedGateArtifactIds(derived.proposal, derived.decision)
  );
  if (unlocated.length > 0) {
    return {
      status: 'refused',
      reason: 'ARTIFACT_UNLOCATED',
      message: 'Store every cited artifact (outcomes:artifacts:store-evidence) before recording.',
      unlocatedArtifactIds: unlocated,
    };
  }

  const summary = {
    predecessorDecisionId: predecessor.decisionId,
    decisionId: derived.decision.decisionId,
    proposalId: derived.proposal.proposalId,
    rightsArtifactId: derived.sourceRights.rightsArtifactId,
    revalidateAt: parsed.revalidateAt,
    termsExpireAt: derived.sourceRights.content.termsExpireAt,
  };
  // The dry run shows every derived record, so the owner reads the rewritten text before the
  // append-only ledger holds it.
  if (!parsed.apply)
    return {
      status: 'dry_run',
      ...summary,
      derived: {
        sourceRights: derived.sourceRights.content,
        proposal: derived.proposal.content,
        decision: derived.decision.content,
      },
    };
  await ledger.appendBatch({ expectedRevision: stored.revision, records: [derived] });
  // Proves the runner reads the written decision, not just the preview.
  const accepted = await loadRecordedLocalCaptureAuthority(
    ledger,
    parsed.capabilityId,
    parsed.season,
    now()
  );
  if (accepted.decisionId !== derived.decision.decisionId) {
    throw new Error(`The runner reads ${accepted.decisionId}, not the recorded decision.`);
  }
  return { status: 'recorded', ...summary };
}

export async function runSeasonSourceDecisionCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<SeasonSourceDecisionOutcome> {
  const { databaseUrl, ...parsed } = parseSeasonSourceDecisionArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const outcome = await recordSeasonSourceDecision(createPgAflOutcomeSqlClient(pool), parsed);
    write(
      JSON.stringify({
        capability: parsed.capabilityId,
        season: parsed.season,
        decisionKey: localExternalCaptureDecisionKey(parsed.capabilityId, parsed.season),
        ...outcome,
      })
    );
    return outcome;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runSeasonSourceDecisionCommand({ argv: process.argv.slice(2), env: process.env })
    .then((outcome) => {
      if (outcome.status === 'refused') process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Season source decision stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
