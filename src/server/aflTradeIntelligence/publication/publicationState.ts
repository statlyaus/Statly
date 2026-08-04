import type {
  AflTradePublicationRef,
  AflTradePublicationState,
  AflTradeValuationView,
} from '@/types/aflTradeIntelligence';
import { z } from 'zod';

import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
  type AflTradeProjectionManifest,
  type AflTradePublicationManifest,
} from '../artifacts/manifestContracts';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import type {
  AflTradeDecisionEnvironment,
  AflTradeGateCode,
} from '../governance/gateDecisionTypes';

export interface AflTradePublicationEvent {
  from: AflTradePublicationState | null;
  to: AflTradePublicationState;
  occurredAt: string;
  actor: string;
  evidenceId: string;
  reason: string | null;
}

export interface AflTradePublicationRecord {
  publicationId: string;
  scopeKey: string;
  valuationBundleId: string;
  valueUnitId: string;
  supportedViews: readonly AflTradeValuationView[];
  supportedCohorts: readonly string[];
  excludedCohorts: readonly string[];
  manifestContentSha256: string;
  state: AflTradePublicationState;
  createdAt: string;
  projectionId: string | null;
  gate4DecisionId: string | null;
  gate5DecisionId: string | null;
  events: readonly AflTradePublicationEvent[];
}

export interface AflTradeActivePublicationPointer {
  publicationId: string;
  activatedAt: string;
  revision: number;
}

export interface AflTradePublicationRegistry {
  revision: number;
  publications: Readonly<Record<string, AflTradePublicationRecord>>;
  activeByScope: Readonly<Record<string, AflTradeActivePublicationPointer>>;
}

export interface AflTradePublicationReadSelection {
  publication: AflTradePublicationRef;
  projectionBuildId: string;
  registryRevision: number;
  scopeKey: string;
  supportedViews: readonly AflTradeValuationView[];
  supportedCohorts: readonly string[];
  excludedCohorts: readonly string[];
}

interface CommandMetadata {
  publicationId: string;
  occurredAt: string;
  actor: string;
  evidenceId: string;
  reason?: string;
}

export type AflTradePublicationCommand =
  | (CommandMetadata & { action: 'validate'; projectionManifest: AflTradeProjectionManifest })
  | (CommandMetadata & {
      action: 'approve';
      gateDecisionId: string;
      gateDecisionLedger: AflTradeGateDecisionLedger;
      environment: AflTradeDecisionEnvironment;
    })
  | (CommandMetadata & {
      action: 'publish';
      gateDecisionId: string;
      gateDecisionLedger: AflTradeGateDecisionLedger;
      environment: AflTradeDecisionEnvironment;
    })
  | (CommandMetadata & { action: 'reject' })
  | (CommandMetadata & { action: 'withdraw' });

export type AflTradePublicationStateErrorCode =
  | 'DUPLICATE_PUBLICATION'
  | 'PUBLICATION_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INVALID_ACTIVE_POINTER'
  | 'INVALID_TIMESTAMP'
  | 'NON_MONOTONIC_EVENT'
  | 'INVALID_MANIFEST'
  | 'INVALID_COMMAND';

export class AflTradePublicationStateError extends Error {
  constructor(
    public readonly code: AflTradePublicationStateErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradePublicationStateError';
  }
}

export function createAflTradePublicationRegistry(): AflTradePublicationRegistry {
  return { revision: 0, publications: {}, activeByScope: {} };
}

function requireTimestamp(value: string) {
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) {
    throw new AflTradePublicationStateError('INVALID_TIMESTAMP', 'A valid timestamp is required.');
  }
}

function requireCommandMetadata(metadata: Omit<CommandMetadata, 'publicationId'>) {
  requireTimestamp(metadata.occurredAt);
  if (!metadata.actor.trim() || !metadata.evidenceId.trim()) {
    throw new AflTradePublicationStateError(
      'INVALID_COMMAND',
      'Publication commands require an actor and evidence identifier.'
    );
  }
}

function appendEvent(
  record: AflTradePublicationRecord,
  to: AflTradePublicationState,
  metadata: Omit<CommandMetadata, 'publicationId'>
): AflTradePublicationRecord {
  requireCommandMetadata(metadata);
  const previousEvent = record.events.at(-1);
  if (previousEvent && Date.parse(metadata.occurredAt) < Date.parse(previousEvent.occurredAt)) {
    throw new AflTradePublicationStateError(
      'NON_MONOTONIC_EVENT',
      'Publication events must be appended in chronological order.'
    );
  }
  return {
    ...record,
    state: to,
    events: [
      ...record.events,
      {
        from: record.state,
        to,
        occurredAt: metadata.occurredAt,
        actor: metadata.actor,
        evidenceId: metadata.evidenceId,
        reason: metadata.reason ?? null,
      },
    ],
  };
}

export function registerAflTradePublication(
  registry: AflTradePublicationRegistry,
  input: {
    manifest: AflTradePublicationManifest;
    actor: string;
    evidenceId: string;
  }
): AflTradePublicationRegistry {
  const parsedManifest = aflTradePublicationManifestSchema.safeParse(input.manifest);
  if (!parsedManifest.success) {
    throw new AflTradePublicationStateError('INVALID_MANIFEST', 'Publication manifest is invalid.');
  }
  const manifest = parsedManifest.data;
  const publicationId = manifest.publicationId;
  if (registry.publications[publicationId]) {
    throw new AflTradePublicationStateError(
      'DUPLICATE_PUBLICATION',
      `Publication ${publicationId} is already registered.`
    );
  }
  requireTimestamp(manifest.content.createdAt);
  if (!input.actor.trim() || !input.evidenceId.trim()) {
    throw new AflTradePublicationStateError(
      'INVALID_COMMAND',
      'Registration requires a scope, actor, and evidence identifier.'
    );
  }
  const record: AflTradePublicationRecord = {
    publicationId,
    scopeKey: manifest.content.scopeKey,
    valuationBundleId: manifest.content.valuationBundleId,
    valueUnitId: manifest.content.valueUnitId,
    supportedViews: manifest.content.supportedViews,
    supportedCohorts: manifest.content.supportedCohorts,
    excludedCohorts: manifest.content.excludedCohorts,
    manifestContentSha256: publicationId.slice('publication:'.length),
    state: 'candidate',
    createdAt: manifest.content.createdAt,
    projectionId: null,
    gate4DecisionId: null,
    gate5DecisionId: null,
    events: [
      {
        from: null,
        to: 'candidate',
        occurredAt: manifest.content.createdAt,
        actor: input.actor,
        evidenceId: input.evidenceId,
        reason: null,
      },
    ],
  };
  return {
    ...registry,
    revision: registry.revision + 1,
    publications: { ...registry.publications, [record.publicationId]: record },
  };
}

const commandTargetState: Record<
  Exclude<AflTradePublicationCommand['action'], 'publish'>,
  AflTradePublicationState
> = {
  validate: 'validated',
  approve: 'approved',
  reject: 'rejected',
  withdraw: 'withdrawn',
};

const allowedFrom: Record<
  AflTradePublicationCommand['action'],
  readonly AflTradePublicationState[]
> = {
  validate: ['candidate'],
  approve: ['validated'],
  publish: ['approved', 'superseded'],
  reject: ['candidate', 'validated', 'approved'],
  withdraw: ['published', 'superseded'],
};

function requirePublication(
  registry: AflTradePublicationRegistry,
  publicationId: string
): AflTradePublicationRecord {
  const record = registry.publications[publicationId];
  if (!record) {
    throw new AflTradePublicationStateError(
      'PUBLICATION_NOT_FOUND',
      `Publication ${publicationId} does not exist.`
    );
  }
  return record;
}

function requireTransition(
  record: AflTradePublicationRecord,
  action: AflTradePublicationCommand['action']
) {
  if (!allowedFrom[action].includes(record.state)) {
    throw new AflTradePublicationStateError(
      'INVALID_TRANSITION',
      `Cannot ${action} publication ${record.publicationId} from ${record.state}.`
    );
  }
}

function requireGateDecision(
  command: Extract<AflTradePublicationCommand, { action: 'approve' | 'publish' }>,
  gate: AflTradeGateCode,
  record: AflTradePublicationRecord
) {
  const decision = command.gateDecisionLedger.decisions.find(
    (candidate) => candidate.decisionId === command.gateDecisionId
  );
  if (!decision || decision.content.gate !== gate) {
    throw new AflTradePublicationStateError(
      'INVALID_COMMAND',
      `A current ${gate} decision is required.`
    );
  }
  const resolution = resolveAflTradeGateEligibility(command.gateDecisionLedger, {
    gate,
    decisionKey: decision.content.decisionKey,
    environment: command.environment,
    evaluatedAt: command.occurredAt,
  });
  const required = [
    { kind: 'publication', artifactId: record.publicationId },
    { kind: 'projection', artifactId: record.projectionId },
  ];
  if (
    resolution.status !== 'mechanically_eligible' ||
    resolution.decision?.decisionId !== command.gateDecisionId ||
    required.some(
      (reference) =>
        reference.artifactId === null ||
        !decision.content.affectedArtifacts.some(
          (artifact) =>
            artifact.kind === reference.kind && artifact.artifactId === reference.artifactId
        )
    )
  ) {
    throw new AflTradePublicationStateError(
      'INVALID_COMMAND',
      `The ${gate} decision is ineffective or does not pin this publication and projection.`
    );
  }
}

function publish(
  registry: AflTradePublicationRegistry,
  record: AflTradePublicationRecord,
  command: AflTradePublicationCommand
): AflTradePublicationRegistry {
  const revision = registry.revision + 1;
  const publications = { ...registry.publications };
  const currentPointer = registry.activeByScope[record.scopeKey];
  if (currentPointer && currentPointer.publicationId !== record.publicationId) {
    const current = requirePublication(registry, currentPointer.publicationId);
    if (current.state !== 'published' || current.scopeKey !== record.scopeKey) {
      throw new AflTradePublicationStateError(
        'INVALID_ACTIVE_POINTER',
        `Scope ${record.scopeKey} does not point to a published publication.`
      );
    }
    publications[current.publicationId] = appendEvent(current, 'superseded', {
      ...command,
      evidenceId: command.evidenceId,
      reason: `Superseded by ${record.publicationId}.`,
    });
  }

  publications[record.publicationId] = appendEvent(record, 'published', command);
  return {
    revision,
    publications,
    activeByScope: {
      ...registry.activeByScope,
      [record.scopeKey]: {
        publicationId: record.publicationId,
        activatedAt: command.occurredAt,
        revision,
      },
    },
  };
}

function withdraw(
  registry: AflTradePublicationRegistry,
  record: AflTradePublicationRecord,
  command: AflTradePublicationCommand
): AflTradePublicationRegistry {
  const revision = registry.revision + 1;
  const publications = {
    ...registry.publications,
    [record.publicationId]: appendEvent(record, 'withdrawn', command),
  };
  const activeByScope = { ...registry.activeByScope };
  const currentPointer = activeByScope[record.scopeKey];

  if (currentPointer?.publicationId === record.publicationId) {
    // A superseded publication is not silently reactivated. It must pass current gates again.
    delete activeByScope[record.scopeKey];
  }

  return { revision, publications, activeByScope };
}

export function applyAflTradePublicationCommand(
  registry: AflTradePublicationRegistry,
  command: AflTradePublicationCommand
): AflTradePublicationRegistry {
  const record = requirePublication(registry, command.publicationId);
  requireTransition(record, command.action);
  if ((command.action === 'reject' || command.action === 'withdraw') && !command.reason?.trim()) {
    throw new AflTradePublicationStateError(
      'INVALID_COMMAND',
      `${command.action} commands require a reason.`
    );
  }

  if (command.action === 'validate') {
    const parsedProjection = aflTradeProjectionManifestSchema.safeParse(command.projectionManifest);
    if (!parsedProjection.success) {
      throw new AflTradePublicationStateError(
        'INVALID_MANIFEST',
        'Projection manifest is invalid.'
      );
    }
    const projection = parsedProjection.data;
    if (
      projection.content.publicationId !== record.publicationId ||
      projection.content.scopeKey !== record.scopeKey ||
      Date.parse(projection.content.createdAt) < Date.parse(record.createdAt)
    ) {
      throw new AflTradePublicationStateError(
        'INVALID_MANIFEST',
        'Validation requires a matching downstream projection manifest.'
      );
    }
    return {
      ...registry,
      revision: registry.revision + 1,
      publications: {
        ...registry.publications,
        [record.publicationId]: appendEvent(
          { ...record, projectionId: projection.projectionId },
          'validated',
          command
        ),
      },
    };
  }

  if (command.action === 'approve') {
    requireGateDecision(command, 'gate_4_publication_api_readiness', record);
    return {
      ...registry,
      revision: registry.revision + 1,
      publications: {
        ...registry.publications,
        [record.publicationId]: appendEvent(
          { ...record, gate4DecisionId: command.gateDecisionId },
          'approved',
          command
        ),
      },
    };
  }

  if (command.action === 'publish') {
    requireGateDecision(command, 'gate_5_comprehension_accessibility', record);
    return publish(registry, { ...record, gate5DecisionId: command.gateDecisionId }, command);
  }
  if (command.action === 'withdraw') return withdraw(registry, record, command);

  const targetState = commandTargetState[command.action];
  return {
    ...registry,
    revision: registry.revision + 1,
    publications: {
      ...registry.publications,
      [record.publicationId]: appendEvent(record, targetState, command),
    },
  };
}

export function getActiveAflTradePublication(
  registry: AflTradePublicationRegistry,
  scopeKey: string
): AflTradePublicationRecord | null {
  const pointer = registry.activeByScope[scopeKey];
  if (!pointer) return null;
  const record = registry.publications[pointer.publicationId];
  if (!record || record.scopeKey !== scopeKey || record.state !== 'published') {
    throw new AflTradePublicationStateError(
      'INVALID_ACTIVE_POINTER',
      `Scope ${scopeKey} has an invalid active-publication pointer.`
    );
  }
  return record;
}

export function captureAflTradePublicationRead(
  registry: AflTradePublicationRegistry,
  scopeKey: string
): AflTradePublicationReadSelection | null {
  const active = getActiveAflTradePublication(registry, scopeKey);
  if (!active) return null;

  const pointer = registry.activeByScope[scopeKey];
  if (!pointer || active.projectionId === null) {
    throw new AflTradePublicationStateError(
      'INVALID_ACTIVE_POINTER',
      `Scope ${scopeKey} does not identify a complete serving publication.`
    );
  }

  return {
    publication: {
      publicationId: active.publicationId,
      state: 'published',
      valuationBundleId: active.valuationBundleId,
      valueUnitId: active.valueUnitId,
      publishedAt: pointer.activatedAt,
    },
    projectionBuildId: active.projectionId,
    registryRevision: registry.revision,
    scopeKey: active.scopeKey,
    supportedViews: [...active.supportedViews],
    supportedCohorts: [...active.supportedCohorts],
    excludedCohorts: [...active.excludedCohorts],
  };
}
