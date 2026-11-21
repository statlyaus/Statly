import { readFile } from 'node:fs/promises';

import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  doesAflTradeExternalIdentityDecisionCoverWorkItem,
  type AflTradeExternalIdentityReviewPackage,
} from '../source/externalIdentityReviewContracts';
import { recordAflTradeExternalIdentityReviewDecision } from '../source/externalIdentityReviewService';
import { buildAflTradeExternalIdentityReviewPackage } from '../source/externalIdentityReviewWorkBuilder';
import {
  databaseNow,
  loadCanonicalPlayerRegistrationState,
  loadCurrentIdentityReviewerGrants,
  loadLocatedApprovalArtifact,
  loadSameNameApprovedPlayerIds,
  MAXIMUM_SNAPSHOT_BYTES,
  PostgresAflTradeExternalCanonicalPlayerCreationRepository,
} from '../source/postgresExternalCanonicalPlayerCreationRepository';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '../source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '../source/postgresExternalIdentityReviewRepository';
import {
  checkDrafteeRegistration,
  draftguruDrafteePlayerId,
  earlierSameNamePlanPlayerIds,
  parseDrafteeRegistrationPlan,
  type DrafteeRegistrationPlanEntry,
} from './drafteeRegistrationPlan';
import { bindLocalAflTradeArtifactRepository } from './localArtifactStoreBinding';

/**
 * The run behind `npm run outcomes:sources:register-draftees` (runbook "Registering a season's
 * national draftees"): plans each draftee of a reviewed plan against one completion and, on apply,
 * creates and links it, one at a time in plan order.
 */

const SNAPSHOT_REPOSITORY_ID = 'canonical-target-snapshots';

type PackageItem = AflTradeExternalIdentityReviewPackage['content']['items'][number];
type Provider = 'draftguru' | 'footyinfo';

export interface RegisterDrafteesOptions {
  completionId: string;
  planPath: string;
  approvalArtifactId: string;
  principalRef: string;
  storeId: string;
  apply: boolean;
}

interface LinkLine {
  provider: Provider;
  subjectId: string;
  action: 'link' | 'already_linked' | 'linked' | 'refused';
  decisionId?: string;
  error?: string;
}

interface DrafteeLine {
  draftguruNativeId: string;
  displayName: string;
  playerId: string;
  status: 'create' | 'created' | 'already_registered' | 'hold' | 'refused';
  reasons?: string[];
  unreviewedSameNamePlayerIds?: string[];
  registrationDecisionId?: string;
  linkFailed?: true;
  links: LinkLine[];
}

export interface RegisterDrafteesOutcome {
  status: 'planned' | 'applied' | 'refused';
  draftees: DrafteeLine[];
}

interface Context {
  client: AflOutcomeSqlClient;
  options: RegisterDrafteesOptions;
  items: readonly PackageItem[];
  reviews: PostgresAflTradeExternalIdentityReviewRepository;
}

interface PlannedDraftee {
  line: DrafteeLine;
  draftguru: PackageItem | null;
  grants: Map<Provider, { id: string; sha256: string }>;
}

/** `planSameName`: earlier plan lines with this name key, which the run creates first. */
async function planDraftee(
  context: Context,
  entry: DrafteeRegistrationPlanEntry,
  planSameName: readonly string[]
): Promise<PlannedDraftee> {
  const playerId = draftguruDrafteePlayerId(entry.draftguruNativeId);
  const line: DrafteeLine = {
    draftguruNativeId: entry.draftguruNativeId,
    displayName: entry.displayName,
    playerId,
    status: 'create',
    links: [],
  };
  const stop = (status: 'refused' | 'hold', detail: Partial<DrafteeLine>) => {
    Object.assign(line, { status, links: [] }, detail);
    return { line, draftguru: null, grants: new Map() };
  };
  const state = await loadCanonicalPlayerRegistrationState(context.client, playerId);
  if (state === 'unregistered_player') {
    return stop('refused', { reasons: ['player_exists_without_registration'] });
  }
  // A registered draftee is not created again, so its same-name players need no review now:
  // checking against its own reviewed list leaves only the subject checks.
  const sameName =
    state === 'registered'
      ? (entry.distinctFromPlayerIds ?? [])
      : [
          ...new Set([
            ...(await loadSameNameApprovedPlayerIds(context.client, playerId, entry.displayName)),
            ...planSameName,
          ]),
        ];
  const check = checkDrafteeRegistration(entry, context.items, sameName);
  if (check.status === 'refused') {
    const listed = check.listedNotSameName.map((id) => `not_same_name:${id}`);
    return stop('refused', { reasons: [...check.reasons, ...listed] });
  }
  if (check.status === 'hold') {
    return stop('hold', { unreviewedSameNamePlayerIds: check.unreviewedSameNamePlayerIds });
  }
  if (state === 'registered') line.status = 'already_registered';
  const subjects = new Map<Provider, PackageItem>([['draftguru', check.draftguru]]);
  if (check.footyinfo !== null) subjects.set('footyinfo', check.footyinfo);
  const grants = new Map<Provider, { id: string; sha256: string }>();
  const reasons: string[] = [];
  for (const [provider, item] of subjects) {
    const current = await context.reviews.loadCurrentDecision(item.subjectId);
    if (current !== null) {
      if (
        current.content.decision !== 'approved' ||
        current.content.canonicalTarget?.canonicalId !== playerId ||
        !doesAflTradeExternalIdentityDecisionCoverWorkItem(current, item.workItem)
      ) {
        reasons.push(`subject_already_decided:${provider}`);
      } else {
        line.links.push({ provider, subjectId: item.subjectId, action: 'already_linked' });
      }
      continue;
    }
    line.links.push({ provider, subjectId: item.subjectId, action: 'link' });
    // A grant is needed only for what this run writes: the creation and each new link.
    const found = await loadCurrentIdentityReviewerGrants(
      context.client,
      context.options.principalRef,
      item.workItem
    );
    if (found.length === 1) grants.set(provider, found[0]!);
    else
      reasons.push(`${found.length === 0 ? 'no_current' : 'several'}_reviewer_grant:${provider}`);
  }
  if (reasons.length > 0) return stop('refused', { reasons });
  return { line, draftguru: check.draftguru, grants };
}

function rationale(entry: DrafteeRegistrationPlanEntry, approvalArtifactId: string): string {
  const footyinfo =
    entry.footyinfoNativeId === undefined ? '' : `, Footyinfo ${entry.footyinfoNativeId}`;
  return `${entry.season} national draft: ${entry.displayName}, ${entry.draftingClub} pick ${entry.pick} (Draftguru ${entry.draftguruNativeId}${footyinfo}). Created and linked under owner approval ${approvalArtifactId}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
}

async function applyDraftee(
  context: Context & {
    creator: PostgresAflTradeExternalCanonicalPlayerCreationRepository;
    approval: AflTradeArtifactRef;
    source: PostgresAflTradeExternalHistoricalReconciliationSource;
  },
  entry: DrafteeRegistrationPlanEntry,
  planned: PlannedDraftee
): Promise<void> {
  const { line } = planned;
  const reason = rationale(entry, context.options.approvalArtifactId);
  if (line.status === 'create') {
    try {
      const created = await context.creator.createPlayer({
        completionId: context.options.completionId,
        workItem: planned.draftguru!.workItem,
        canonicalId: line.playerId,
        displayName: entry.displayName,
        reviewerAuthority: {
          principalRef: context.options.principalRef,
          authorityEvidence: planned.grants.get('draftguru')!,
        },
        supportingEvidence: [context.approval],
        rationale: reason,
        ...(entry.distinctFromPlayerIds === undefined
          ? {}
          : { distinctFromPlayerIds: entry.distinctFromPlayerIds }),
      });
      line.status = 'created';
      line.registrationDecisionId = created.registrationDecisionId;
    } catch (error) {
      Object.assign(line, { status: 'refused', reasons: [errorMessage(error)] });
      return;
    }
  }
  for (const link of line.links) {
    if (link.action !== 'link') continue;
    try {
      const recorded = await recordAflTradeExternalIdentityReviewDecision(
        {
          completionId: context.options.completionId,
          subjectId: link.subjectId,
          decision: 'approved',
          canonicalId: line.playerId,
          rationale: reason,
          authorityEvidenceId: planned.grants.get(link.provider)!.id,
          decidedBy: context.options.principalRef,
          decidedAt: await databaseNow(context.client),
        },
        { source: context.source, reviewRepository: context.reviews }
      );
      Object.assign(link, { action: 'linked', decisionId: recorded.decisionId });
    } catch (error) {
      // The player stays created; a rerun skips it and retries the link.
      Object.assign(link, { action: 'refused', error: errorMessage(error) });
      line.linkFailed = true;
    }
  }
}

/** Plans each draftee, and on apply creates and links it, one at a time in plan order. */
export async function registerDraftees(input: {
  client: AflOutcomeSqlClient;
  options: RegisterDrafteesOptions;
  write: (line: string) => void;
}): Promise<RegisterDrafteesOutcome> {
  const { client, options, write } = input;
  const entries = parseDrafteeRegistrationPlan(await readFile(options.planPath, 'utf8'));
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(client);
  const loaded = await source.load(options.completionId);
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
    environment: loaded.environment,
    competition: loaded.competition,
    sourceAuthority: loaded.sourceAuthority,
    sourceBatches: loaded.sourceBatches,
  });
  const approval = await loadLocatedApprovalArtifact(client, options.approvalArtifactId);
  if (reviewPackage.content.environment !== 'non_production' || approval === null) {
    const reason =
      approval === null
        ? 'approval_artifact_not_located_metadata'
        : 'completion_not_non_production';
    write(JSON.stringify({ status: 'refused', reason }));
    return { status: 'refused', draftees: [] };
  }
  const context = {
    client,
    options,
    items: reviewPackage.content.items,
    reviews: new PostgresAflTradeExternalIdentityReviewRepository(client),
    approval,
    source,
  };
  // Only an apply binds (and so creates) the snapshot repository; a dry run writes nothing.
  const creator = options.apply
    ? new PostgresAflTradeExternalCanonicalPlayerCreationRepository(
        client,
        await bindLocalAflTradeArtifactRepository(client, {
          storeId: options.storeId,
          repositoryId: SNAPSHOT_REPOSITORY_ID,
          artifactClass: 'capture_metadata',
          maximumObjectBytes: MAXIMUM_SNAPSHOT_BYTES,
        })
      )
    : null;
  const draftees: DrafteeLine[] = [];
  for (const [index, entry] of entries.entries()) {
    const planned = await planDraftee(context, entry, earlierSameNamePlanPlayerIds(entries, index));
    if (creator !== null) await applyDraftee({ ...context, creator }, entry, planned);
    write(JSON.stringify(planned.line));
    draftees.push(planned.line);
  }
  const count = (status: DrafteeLine['status']) =>
    draftees.filter((line) => line.status === status).length;
  const links = (action: LinkLine['action']) =>
    draftees.flatMap((line) => line.links).filter((link) => link.action === action).length;
  const linkFailed = draftees.filter((line) => line.linkFailed).length;
  const unfinished = count('hold') + count('refused') + linkFailed;
  const status = unfinished > 0 ? 'refused' : options.apply ? 'applied' : 'planned';
  write(
    JSON.stringify({
      status,
      mode: options.apply ? 'apply' : 'dry_run',
      completionId: options.completionId,
      draftees: draftees.length,
      create: count('create'),
      created: count('created'),
      alreadyRegistered: count('already_registered'),
      holds: count('hold'),
      refused: count('refused'),
      linkFailed,
      link: links('link'),
      linked: links('linked'),
      alreadyLinked: links('already_linked'),
    })
  );
  return { status, draftees };
}
