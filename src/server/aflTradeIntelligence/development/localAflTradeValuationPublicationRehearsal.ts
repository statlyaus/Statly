import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradePublicationManifest } from '../artifacts/publicationProjectionManifests';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
} from '../governance/gateDecisionTypes';
import {
  createPostgresAflTradeGateDecisionLedgerRepository,
  type AflTradeGateDecisionLedgerRepository,
} from '../governance/postgresGateDecisionLedgerRepository';
import {
  createPostgresAflDraftTradeOutcomeReleaseRepository,
  type AflOutcomeSqlClient,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  createPostgresAflTradePublicationRepository,
  type AflTradePublicationRepository,
} from '../publication/postgresPublicationRepository';
import {
  createPostgresAflTradeValuationPublicationCommandService,
  type AflTradeValuationPublicationCommandService,
  type AflTradeValuationPublicationRegistrationResult,
} from '../publication/valuationPublicationCommandService';
import { prepareLocalAflTradeValuationCandidate } from './localAflTradeValuationPublicationCandidate';
import type { seedLocalAflTradeOutcomeArchive } from './postgresLocalOutcomeArchiveSeed';

const ACTOR = 'local-synthetic-valuation-rehearsal';
const ENVIRONMENT = 'test_fixture' as const;

interface TrustedTimeRow extends Record<string, unknown> {
  trusted_at: string | Date;
}

export interface LocalAflTradeRegisteredValuationCandidate {
  scenario: 'baseline' | 'replacement';
  registration: AflTradeValuationPublicationRegistrationResult;
  projectionVerification: unknown;
}

export interface LocalAflTradeValuationPublicationRehearsalInput<TFactualState> {
  client: AflOutcomeSqlClient;
  publicationRepository: AflTradePublicationRepository;
  publicationCommand: AflTradeValuationPublicationCommandService;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'appendDecision'>;
  baseline: LocalAflTradeRegisteredValuationCandidate;
  replacement: LocalAflTradeRegisteredValuationCandidate;
  captureFactualState(): Promise<TFactualState>;
}

function publicationOf(candidate: LocalAflTradeRegisteredValuationCandidate) {
  const publication = candidate.registration.publication.publicationManifest;
  if (publication.content.environment !== ENVIRONMENT) {
    throw new TypeError('The local valuation rehearsal is restricted to test_fixture.');
  }
  return publication;
}

async function trustedNow(client: AflOutcomeSqlClient): Promise<string> {
  const result = await client.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (result.rows.length !== 1 || value === undefined) {
    throw new TypeError('The local valuation rehearsal requires one PostgreSQL timestamp.');
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function gateAuthority(input: {
  gate: Extract<
    AflTradeGateCode,
    'gate_4_publication_api_readiness' | 'gate_5_comprehension_accessibility'
  >;
  scenario: LocalAflTradeRegisteredValuationCandidate['scenario'];
  publication: AflTradePublicationManifest;
  projectionId: string;
  decidedAt: string;
}) {
  const decisionKey = `local-synthetic-${input.scenario}-${input.gate}`;
  const authorityEvidenceId = createAflTradeContentAddress('artifact', {
    decisionKey,
    authority: 'fixture-only-local-rehearsal',
  });
  const scope = {
    scopeKey: input.publication.content.scopeKey,
    description: 'Disposable local synthetic valuation-publication rehearsal only.',
    dimensions: [
      { name: 'environment', values: [ENVIRONMENT] },
      { name: 'evidence', values: ['fabricated-test-evidence'] },
    ],
    exclusions: [
      'Production authority',
      'Hosted deployment',
      'Live source access',
      'Real Draftguru model-training rights',
    ],
  };
  const affectedArtifacts = [
    { kind: 'publication' as const, artifactId: input.publication.publicationId },
    { kind: 'projection' as const, artifactId: input.projectionId },
  ];
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey,
    version: 1,
    environment: ENVIRONMENT,
    scope,
    proposal: 'Exercise the exact synthetic local publication and projection pair.',
    alternativesConsidered: ['Keep the previous disposable local valuation selection.'],
    accountableOwner: ACTOR,
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [authorityEvidenceId],
    affectedArtifacts,
    proposedAt: input.decidedAt,
    proposedBy: ACTOR,
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: input.gate,
    decisionKey,
    version: 1,
    environment: ENVIRONMENT,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: ACTOR,
    decidedBy: ACTOR,
    reviewers: [],
    authorityEvidenceIds: [authorityEvidenceId],
    conditionResults: [],
    rationale: 'The exact local synthetic artifacts passed the rehearsal checks.',
    limitations: ['Fixture authority is valid only inside disposable local PostgreSQL.'],
    decidedAt: input.decidedAt,
    effectiveAt: input.decidedAt,
    revalidateAt: new Date(Date.parse(input.decidedAt) + 24 * 60 * 60 * 1_000).toISOString(),
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

async function appendAuthority(
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'appendDecision'>,
  authority: ReturnType<typeof gateAuthority>
): Promise<string> {
  let stored = await gateRepository.load();
  if (
    !stored.ledger.decisions.some(({ decisionId }) => decisionId === authority.decision.decisionId)
  ) {
    stored = await gateRepository.appendDecision({
      expectedRevision: stored.revision,
      proposal: authority.proposal,
      decision: authority.decision,
    });
  }
  return authority.decision.decisionId;
}

function activePublicationId(
  registry: Awaited<ReturnType<AflTradePublicationRepository['load']>>,
  scopeKey: string
): string | null {
  return registry.activeByScope[scopeKey]?.publicationId ?? null;
}

async function validateAndAuthorize(input: {
  client: AflOutcomeSqlClient;
  publicationCommand: AflTradeValuationPublicationCommandService;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'appendDecision'>;
  candidate: LocalAflTradeRegisteredValuationCandidate;
}) {
  const publication = publicationOf(input.candidate);
  const validation = await input.publicationCommand.validate({
    verification: input.candidate.projectionVerification,
    actor: ACTOR,
  });
  const record = validation.mutation.registry.publications[publication.publicationId];
  if (record?.state !== 'validated' || record.projectionId === null) {
    throw new TypeError('The local valuation candidate did not reach validated projection state.');
  }
  const gate4 = gateAuthority({
    gate: 'gate_4_publication_api_readiness',
    scenario: input.candidate.scenario,
    publication,
    projectionId: record.projectionId,
    decidedAt: await trustedNow(input.client),
  });
  const gate4DecisionId = await appendAuthority(input.gateRepository, gate4);
  const approved = await input.publicationCommand.authorize({
    action: 'approve',
    publicationId: publication.publicationId,
    gateDecisionId: gate4DecisionId,
    actor: ACTOR,
  });
  if (approved.registry.publications[publication.publicationId]?.state !== 'approved') {
    throw new TypeError('The local valuation candidate did not reach approved state.');
  }
  const gate5 = gateAuthority({
    gate: 'gate_5_comprehension_accessibility',
    scenario: input.candidate.scenario,
    publication,
    projectionId: record.projectionId,
    decidedAt: await trustedNow(input.client),
  });
  return {
    publication,
    projectionId: record.projectionId,
    gate5DecisionId: await appendAuthority(input.gateRepository, gate5),
  };
}

async function publish(
  command: AflTradeValuationPublicationCommandService,
  candidate: Awaited<ReturnType<typeof validateAndAuthorize>>
) {
  return command.authorize({
    action: 'publish',
    publicationId: candidate.publication.publicationId,
    gateDecisionId: candidate.gate5DecisionId,
    actor: ACTOR,
  });
}

export async function rehearseLocalAflTradeValuationPublication<TFactualState>(
  input: LocalAflTradeValuationPublicationRehearsalInput<TFactualState>
) {
  const factualStateBefore = await input.captureFactualState();
  const baselinePublication = publicationOf(input.baseline);
  const replacementPublication = publicationOf(input.replacement);
  if (baselinePublication.content.scopeKey !== replacementPublication.content.scopeKey) {
    throw new TypeError('Both local valuation candidates must use one publication scope.');
  }
  const scopeKey = baselinePublication.content.scopeKey;
  const initialRegistry = await input.publicationRepository.load();
  const initialActivePublicationId = activePublicationId(initialRegistry, scopeKey);
  if (initialActivePublicationId === replacementPublication.publicationId) {
    const baselineRecord = initialRegistry.publications[baselinePublication.publicationId];
    const replacementRecord = initialRegistry.publications[replacementPublication.publicationId];
    if (
      baselineRecord?.state !== 'withdrawn' ||
      replacementRecord?.state !== 'published' ||
      baselineRecord.projectionId === null ||
      replacementRecord.projectionId === null
    ) {
      throw new TypeError('The recovered local valuation scope is not the exact rehearsed state.');
    }
    const factualStateAfter = await input.captureFactualState();
    if (
      canonicalizeAflTradeJson(factualStateAfter) !== canonicalizeAflTradeJson(factualStateBefore)
    ) {
      throw new TypeError('The idempotent valuation replay changed the active factual release.');
    }
    return Object.freeze({
      environment: ENVIRONMENT,
      productionEligible: false as const,
      liveSourceAccessed: false as const,
      providerRightsExpanded: false as const,
      idempotentReplay: true as const,
      scopeKey,
      baselinePublicationId: baselinePublication.publicationId,
      replacementPublicationId: replacementPublication.publicationId,
      baselineProjectionId: baselineRecord.projectionId,
      replacementProjectionId: replacementRecord.projectionId,
      activeSequence: [replacementPublication.publicationId],
      factualStateBefore,
      factualStateAfter,
    });
  }
  if (initialActivePublicationId !== null) {
    throw new TypeError('The local valuation rehearsal requires an initially empty value scope.');
  }

  const baseline = await validateAndAuthorize({ ...input, candidate: input.baseline });
  const replacement = await validateAndAuthorize({ ...input, candidate: input.replacement });
  const baselinePublished = await publish(input.publicationCommand, baseline);
  const replacementPublished = await publish(input.publicationCommand, replacement);
  const rolledBack = await publish(input.publicationCommand, baseline);
  const withdrawn = await input.publicationCommand.disposition({
    action: 'withdraw',
    publicationId: baseline.publication.publicationId,
    actor: ACTOR,
    evidenceId: createAflTradeContentAddress('artifact', {
      action: 'withdraw',
      publicationId: baseline.publication.publicationId,
    }),
    reason: 'Prove the disposable local value scope returns to its pre-rehearsal empty state.',
  });
  const recovered = await publish(input.publicationCommand, replacement);

  const activeSequence = [
    activePublicationId(baselinePublished.registry, scopeKey),
    activePublicationId(replacementPublished.registry, scopeKey),
    activePublicationId(rolledBack.registry, scopeKey),
    activePublicationId(withdrawn.registry, scopeKey),
    activePublicationId(recovered.registry, scopeKey),
  ];
  const expectedSequence = [
    baseline.publication.publicationId,
    replacement.publication.publicationId,
    baseline.publication.publicationId,
    null,
    replacement.publication.publicationId,
  ];
  if (canonicalizeAflTradeJson(activeSequence) !== canonicalizeAflTradeJson(expectedSequence)) {
    throw new TypeError('The local valuation publication lifecycle did not select exact releases.');
  }
  const factualStateAfter = await input.captureFactualState();
  if (
    canonicalizeAflTradeJson(factualStateAfter) !== canonicalizeAflTradeJson(factualStateBefore)
  ) {
    throw new TypeError('The valuation lifecycle changed the active factual release.');
  }
  return Object.freeze({
    environment: ENVIRONMENT,
    productionEligible: false as const,
    liveSourceAccessed: false as const,
    providerRightsExpanded: false as const,
    idempotentReplay: false as const,
    scopeKey,
    baselinePublicationId: baseline.publication.publicationId,
    replacementPublicationId: replacement.publication.publicationId,
    baselineProjectionId: baseline.projectionId,
    replacementProjectionId: replacement.projectionId,
    activeSequence,
    factualStateBefore,
    factualStateAfter,
  });
}

export async function prepareAndRehearseLocalAflTradeValuationPublication(input: {
  client: AflOutcomeSqlClient;
  factual: Awaited<ReturnType<typeof seedLocalAflTradeOutcomeArchive>>;
  derivedRepository: AflTradeImmutableArtifactRepository;
  publicProjectionRepository: AflTradeImmutableArtifactRepository;
}) {
  const publicationRepository = createPostgresAflTradePublicationRepository(input.client);
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(input.client);
  const publicationCommand = createPostgresAflTradeValuationPublicationCommandService({
    client: input.client,
    publicationRepository,
    gateRepository,
    environment: ENVIRONMENT,
    artifactRepository: input.publicProjectionRepository,
  });
  const baseline = await prepareLocalAflTradeValuationCandidate({
    client: input.client,
    factual: input.factual,
    scenario: 'baseline',
    derivedRepository: input.derivedRepository,
    publicationCommand,
  });
  const replacement = await prepareLocalAflTradeValuationCandidate({
    client: input.client,
    factual: input.factual,
    scenario: 'replacement',
    derivedRepository: input.derivedRepository,
    publicationCommand,
  });
  const factualReleaseRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(
    input.client
  );
  const captureFactualState = async () => {
    const registry = await factualReleaseRepository.loadRegistry();
    return {
      active: registry.activeByScope[input.factual.factualReleaseManifest.content.scopeKey] ?? null,
      release: registry.releases[input.factual.releaseId] ?? null,
    };
  };
  const lifecycle = await rehearseLocalAflTradeValuationPublication({
    client: input.client,
    publicationRepository,
    publicationCommand,
    gateRepository,
    baseline,
    replacement,
    captureFactualState,
  });
  return Object.freeze({
    publicationRepository,
    gateRepository,
    publicationCommand,
    baseline,
    replacement,
    captureFactualState,
    lifecycle,
  });
}
