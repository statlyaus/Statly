import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import type {
  AflDraftTradeOutcomeReleaseSelector,
  AflDraftTradeOutcomeSelectionSnapshot,
} from './outcomeReadService';
import {
  aflDraftTradeOutcomeActivationAuthorizationSchema,
  aflDraftTradeOutcomeAnyProjectionManifestSchema as aflDraftTradeOutcomeProjectionManifestSchema,
  aflDraftTradeOutcomeAnyReleaseManifestSchema as aflDraftTradeOutcomeReleaseManifestSchema,
  validateAflDraftTradeOutcomeReleaseProjectionPair,
  type AflDraftTradeOutcomeActivationAuthorization,
  type AflDraftTradeOutcomeAnyProjectionManifest as AflDraftTradeOutcomeProjectionManifest,
  type AflDraftTradeOutcomeAnyReleaseManifest as AflDraftTradeOutcomeReleaseManifest,
} from './outcomeReleaseContracts';
import {
  createAflTradeContentAddress,
  isAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import type {
  AflTradeDecisionEnvironment,
  AflTradeGateCode,
  AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';

export const AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES = [
  'candidate',
  'validated',
  'approved',
  'published',
  'superseded',
  'rejected',
  'withdrawn',
] as const;

export type AflDraftTradeOutcomeReleaseState =
  (typeof AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES)[number];

export interface AflDraftTradeOutcomeReleaseEvent {
  revision: number;
  action: 'register' | 'validate' | 'approve' | 'activate' | 'supersede' | 'reject' | 'withdraw';
  from: AflDraftTradeOutcomeReleaseState | null;
  to: AflDraftTradeOutcomeReleaseState;
  occurredAt: string;
  actor: string;
  evidenceId: string;
  gateDecisionId: string | null;
  reason: string | null;
}

export interface AflDraftTradeOutcomeReleaseRecord {
  releaseId: string;
  scopeKey: string;
  state: AflDraftTradeOutcomeReleaseState;
  releaseManifest: AflDraftTradeOutcomeReleaseManifest;
  projectionManifest: AflDraftTradeOutcomeProjectionManifest | null;
  factualReviewDecisionId: string | null;
  gate5DecisionId: string | null;
  activationAuthorizationId: string | null;
  events: readonly AflDraftTradeOutcomeReleaseEvent[];
}

export interface AflDraftTradeOutcomeActiveReleasePointer {
  releaseId: string;
  activatedAt: string;
  revision: number;
}

export interface AflDraftTradeOutcomeReleaseRegistry {
  revision: number;
  releases: Readonly<Record<string, AflDraftTradeOutcomeReleaseRecord>>;
  activeByScope: Readonly<Record<string, AflDraftTradeOutcomeActiveReleasePointer>>;
  events: readonly AflDraftTradeOutcomeRegistryEvent[];
}

export interface AflDraftTradeOutcomeRegistryEventContent {
  schemaVersion: 'afl-draft-trade-outcome-registry-event/v1';
  revision: number;
  previousEventId: string | null;
  action: 'register' | 'validate' | 'approve' | 'activate' | 'reject' | 'withdraw';
  releaseId: string;
  scopeKey: string;
  occurredAt: string;
  actor: string;
  evidenceId: string;
  from: AflDraftTradeOutcomeReleaseState | null;
  to: AflDraftTradeOutcomeReleaseState;
  priorActiveReleaseId: string | null;
  nextActiveReleaseId: string | null;
  gateDecisionId: string | null;
  activationAuthorizationId: string | null;
  affectedRecordStates: readonly {
    releaseId: string;
    recordStateId: string;
    recordState: AflDraftTradeOutcomeReleaseRecord;
  }[];
}

export interface AflDraftTradeOutcomeRegistryEvent {
  eventId: string;
  content: AflDraftTradeOutcomeRegistryEventContent;
}

interface CommandMetadata {
  releaseId: string;
  expectedRevision: number;
  occurredAt: string;
  actor: string;
  evidenceId: string;
  reason?: string;
}

export type AflDraftTradeOutcomeReleaseCommand =
  | (CommandMetadata & {
      action: 'validate';
      environment: AflTradeDecisionEnvironment;
      projectionManifest: AflDraftTradeOutcomeProjectionManifest;
      gateDecisionLedger: AflTradeGateDecisionLedger;
    })
  | (CommandMetadata & {
      action: 'approve';
      environment: AflTradeDecisionEnvironment;
      gateDecisionId: string;
      gateDecisionLedger: AflTradeGateDecisionLedger;
    })
  | (CommandMetadata & {
      action: 'activate';
      environment: AflTradeDecisionEnvironment;
      gateDecisionId: string;
      gateDecisionLedger: AflTradeGateDecisionLedger;
      sourceRightsDecisionLedger: AflTradeGateDecisionLedger;
      factualReviewDecisionLedger: AflTradeGateDecisionLedger;
      activationAuthorization: AflDraftTradeOutcomeActivationAuthorization;
    })
  | (CommandMetadata & { action: 'reject' })
  | (CommandMetadata & { action: 'withdraw' });

export type AflDraftTradeOutcomeReleaseStateErrorCode =
  | 'STALE_REVISION'
  | 'DUPLICATE_RELEASE'
  | 'RELEASE_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'INVALID_ACTIVE_POINTER'
  | 'INVALID_TIMESTAMP'
  | 'NON_MONOTONIC_EVENT'
  | 'INVALID_MANIFEST'
  | 'INVALID_COMMAND'
  | 'INVALID_REGISTRY'
  | 'INEFFECTIVE_DECISION';

export class AflDraftTradeOutcomeReleaseStateError extends Error {
  constructor(
    public readonly code: AflDraftTradeOutcomeReleaseStateErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflDraftTradeOutcomeReleaseStateError';
  }
}

export function createAflDraftTradeOutcomeReleaseRegistry(): AflDraftTradeOutcomeReleaseRegistry {
  return { revision: 0, releases: {}, activeByScope: {}, events: [] };
}

const immutableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const commandLedgerSchema = z
  .object({ proposals: z.array(z.unknown()), decisions: z.array(z.unknown()) })
  .strict();
const commandMetadataShape = {
  releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
  expectedRevision: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime({ offset: true }),
  actor: z.string().trim().min(1).max(200),
  evidenceId: immutableIdSchema,
  reason: z.string().trim().min(1).max(2000).optional(),
};
const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const gateDecisionIdSchema = z.string().regex(/^gate-decision:[a-f0-9]{64}$/);
const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...commandMetadataShape,
      action: z.literal('validate'),
      environment: environmentSchema,
      projectionManifest: aflDraftTradeOutcomeProjectionManifestSchema,
      gateDecisionLedger: commandLedgerSchema,
    })
    .strict(),
  z
    .object({
      ...commandMetadataShape,
      action: z.literal('approve'),
      environment: environmentSchema,
      gateDecisionId: gateDecisionIdSchema,
      gateDecisionLedger: commandLedgerSchema,
    })
    .strict(),
  z
    .object({
      ...commandMetadataShape,
      action: z.literal('activate'),
      environment: environmentSchema,
      gateDecisionId: gateDecisionIdSchema,
      gateDecisionLedger: commandLedgerSchema,
      sourceRightsDecisionLedger: commandLedgerSchema,
      factualReviewDecisionLedger: commandLedgerSchema,
      activationAuthorization: aflDraftTradeOutcomeActivationAuthorizationSchema,
    })
    .strict(),
  z
    .object({
      ...commandMetadataShape,
      action: z.literal('reject'),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      ...commandMetadataShape,
      action: z.literal('withdraw'),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);

const releaseEventSchema = z
  .object({
    revision: z.number().int().positive(),
    action: z.enum([
      'register',
      'validate',
      'approve',
      'activate',
      'supersede',
      'reject',
      'withdraw',
    ]),
    from: z.enum(AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES).nullable(),
    to: z.enum(AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES),
    occurredAt: z.iso.datetime({ offset: true }),
    actor: z.string().trim().min(1).max(200),
    evidenceId: immutableIdSchema,
    gateDecisionId: gateDecisionIdSchema.nullable(),
    reason: z.string().trim().min(1).max(2000).nullable(),
  })
  .strict();

const registryEventContentSchema = z
  .object({
    schemaVersion: z.literal('afl-draft-trade-outcome-registry-event/v1'),
    revision: z.number().int().positive(),
    previousEventId: z
      .string()
      .regex(/^outcome-release-event:[a-f0-9]{64}$/)
      .nullable(),
    action: z.enum(['register', 'validate', 'approve', 'activate', 'reject', 'withdraw']),
    releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
    scopeKey: z.string().trim().min(1).max(200),
    occurredAt: z.iso.datetime({ offset: true }),
    actor: z.string().trim().min(1).max(200),
    evidenceId: immutableIdSchema,
    from: z.enum(AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES).nullable(),
    to: z.enum(AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES),
    priorActiveReleaseId: z
      .string()
      .regex(/^outcome-release:[a-f0-9]{64}$/)
      .nullable(),
    nextActiveReleaseId: z
      .string()
      .regex(/^outcome-release:[a-f0-9]{64}$/)
      .nullable(),
    gateDecisionId: gateDecisionIdSchema.nullable(),
    activationAuthorizationId: z
      .string()
      .regex(/^outcome-activation-authorization:[a-f0-9]{64}$/)
      .nullable(),
    affectedRecordStates: z
      .array(
        z
          .object({
            releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
            recordStateId: z.string().regex(/^outcome-release-record-state:[a-f0-9]{64}$/),
            recordState: z.unknown(),
          })
          .strict()
      )
      .min(1)
      .max(2),
  })
  .strict()
  .superRefine((event, context) => {
    const releaseIds = event.affectedRecordStates.map(({ releaseId }) => releaseId);
    if (
      new Set(releaseIds).size !== releaseIds.length ||
      releaseIds.some((releaseId, index) => index > 0 && releaseIds[index - 1] > releaseId) ||
      !releaseIds.includes(event.releaseId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['affectedRecordStates'],
        message: 'Affected record states must be unique, sorted, and include the command target.',
      });
    }
    const requiresGateDecision = event.action === 'approve' || event.action === 'activate';
    if ((event.gateDecisionId !== null) !== requiresGateDecision) {
      context.addIssue({
        code: 'custom',
        path: ['gateDecisionId'],
        message: 'Only approval and activation events require a gate decision.',
      });
    }
    if ((event.activationAuthorizationId !== null) !== (event.action === 'activate')) {
      context.addIssue({
        code: 'custom',
        path: ['activationAuthorizationId'],
        message: 'Only activation events require operational authorization.',
      });
    }
  });

const registryEventSchema = z
  .object({
    eventId: z.string().regex(/^outcome-release-event:[a-f0-9]{64}$/),
    content: registryEventContentSchema,
  })
  .strict();

function isDeepPlainData(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== 'object' || nodeUtilTypes.isProxy(value) || ancestors.has(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return false;
  } else if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return false;
    if (
      Array.isArray(value) &&
      keys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^\d+$/.test(key)))
    ) {
      return false;
    }
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
      if (!isDeepPlainData(descriptor.value, ancestors)) return false;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function admitCommand(value: unknown): AflDraftTradeOutcomeReleaseCommand {
  try {
    if (!isDeepPlainData(value) || value === null || typeof value !== 'object') {
      throw new TypeError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError();
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError();
      }
      snapshot[key] = descriptor.value;
    }
    const parsed = commandSchema.safeParse(snapshot);
    if (!parsed.success) throw new TypeError();
    return parsed.data as AflDraftTradeOutcomeReleaseCommand;
  } catch {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_COMMAND',
      'Factual release commands require one exact own data-property envelope.'
    );
  }
}

function invalidRegistry(message: string): never {
  throw new AflDraftTradeOutcomeReleaseStateError('INVALID_REGISTRY', message);
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === 'string' && expected.includes(key))
  );
}

function isValidReleaseTransition(
  event: AflDraftTradeOutcomeReleaseEvent,
  eventIndex: number
): boolean {
  if (eventIndex === 0) {
    return event.action === 'register' && event.from === null && event.to === 'candidate';
  }
  if (event.action === 'validate') {
    return (event.from === 'candidate' || event.from === 'superseded') && event.to === 'validated';
  }
  if (event.action === 'approve') return event.from === 'validated' && event.to === 'approved';
  if (event.action === 'activate') return event.from === 'approved' && event.to === 'published';
  if (event.action === 'supersede') {
    return event.from === 'published' && event.to === 'superseded';
  }
  if (event.action === 'reject') {
    return (
      (event.from === 'candidate' || event.from === 'validated' || event.from === 'approved') &&
      event.to === 'rejected'
    );
  }
  return (
    event.action === 'withdraw' &&
    (event.from === 'published' || event.from === 'superseded') &&
    event.to === 'withdrawn'
  );
}

function hasValidReleaseEventHistory(
  candidate: AflDraftTradeOutcomeReleaseRecord,
  maximumRevision: number
): boolean {
  if (!Array.isArray(candidate.events) || candidate.events.length === 0) return false;
  let previous: AflDraftTradeOutcomeReleaseEvent | null = null;
  for (const [eventIndex, eventCandidate] of candidate.events.entries()) {
    const event = releaseEventSchema.safeParse(eventCandidate);
    if (
      !event.success ||
      event.data.revision > maximumRevision ||
      (previous !== null &&
        (event.data.revision <= previous.revision ||
          Date.parse(event.data.occurredAt) < Date.parse(previous.occurredAt) ||
          event.data.from !== previous.to)) ||
      !isValidReleaseTransition(event.data, eventIndex)
    ) {
      return false;
    }
    previous = event.data;
  }
  return previous?.to === candidate.state;
}

function isValidCommittedRecordSnapshot(
  value: unknown,
  releaseId: string,
  revision: number,
  registryEvents: readonly AflDraftTradeOutcomeRegistryEvent[]
): value is AflDraftTradeOutcomeReleaseRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isDeepPlainData(value) ||
    !hasExactOwnKeys(value, [
      'releaseId',
      'scopeKey',
      'state',
      'releaseManifest',
      'projectionManifest',
      'factualReviewDecisionId',
      'gate5DecisionId',
      'activationAuthorizationId',
      'events',
    ])
  ) {
    return false;
  }
  const candidate = value as AflDraftTradeOutcomeReleaseRecord;
  const manifest = aflDraftTradeOutcomeReleaseManifestSchema.safeParse(candidate.releaseManifest);
  if (
    !manifest.success ||
    candidate.releaseId !== releaseId ||
    manifest.data.releaseId !== releaseId ||
    candidate.scopeKey !== manifest.data.content.scopeKey ||
    !gateDecisionIdSchema.nullable().safeParse(candidate.factualReviewDecisionId).success ||
    !gateDecisionIdSchema.nullable().safeParse(candidate.gate5DecisionId).success ||
    !z
      .string()
      .regex(/^outcome-activation-authorization:[a-f0-9]{64}$/)
      .nullable()
      .safeParse(candidate.activationAuthorizationId).success ||
    !hasValidReleaseEventHistory(candidate, revision) ||
    candidate.events.at(-1)?.revision !== revision
  ) {
    return false;
  }
  if (candidate.projectionManifest !== null) {
    if (
      !aflDraftTradeOutcomeProjectionManifestSchema.safeParse(candidate.projectionManifest)
        .success ||
      !validateAflDraftTradeOutcomeReleaseProjectionPair(
        manifest.data,
        candidate.projectionManifest
      )
    ) {
      return false;
    }
  } else if (
    ['validated', 'approved', 'published', 'superseded', 'withdrawn'].includes(candidate.state)
  ) {
    return false;
  }
  const currentCycleRevision =
    candidate.events.filter(({ action }) => action === 'validate').at(-1)?.revision ?? 0;
  const latestApproval = candidate.events
    .filter(({ action, revision: eventRevision }) =>
      action === 'approve' ? eventRevision > currentCycleRevision : false
    )
    .at(-1);
  const latestActivation = candidate.events
    .filter(({ action, revision: eventRevision }) =>
      action === 'activate' ? eventRevision > currentCycleRevision : false
    )
    .at(-1);
  const activationRegistryEvent = latestActivation
    ? registryEventSchema.safeParse(registryEvents[latestActivation.revision - 1])
    : null;
  return (
    candidate.factualReviewDecisionId === (latestApproval?.gateDecisionId ?? null) &&
    candidate.gate5DecisionId === (latestActivation?.gateDecisionId ?? null) &&
    candidate.activationAuthorizationId ===
      (activationRegistryEvent?.success
        ? activationRegistryEvent.data.content.activationAuthorizationId
        : null)
  );
}

function authenticateRegistry(
  value: AflDraftTradeOutcomeReleaseRegistry
): AflDraftTradeOutcomeReleaseRegistry {
  if (!isDeepPlainData(value))
    return invalidRegistry('The factual release registry is not plain data.');
  if (
    !hasExactOwnKeys(value, ['revision', 'releases', 'activeByScope', 'events']) ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.events) ||
    value.events.length !== value.revision ||
    value.releases === null ||
    typeof value.releases !== 'object' ||
    Array.isArray(value.releases) ||
    value.activeByScope === null ||
    typeof value.activeByScope !== 'object' ||
    Array.isArray(value.activeByScope)
  ) {
    return invalidRegistry('The factual release registry envelope is invalid.');
  }

  let previousEventId: string | null = null;
  const latestRecordStateIds = new Map<string, string>();
  const replayedActiveByScope = new Map<string, string>();
  for (const [index, candidate] of value.events.entries()) {
    const parsed = registryEventSchema.safeParse(candidate);
    if (
      !parsed.success ||
      parsed.data.content.revision !== index + 1 ||
      parsed.data.content.previousEventId !== previousEventId ||
      !isAflTradeContentAddress('outcome-release-event', parsed.data.eventId, parsed.data.content)
    ) {
      return invalidRegistry('The factual registry event chain is invalid.');
    }
    for (const affectedRecord of parsed.data.content.affectedRecordStates) {
      if (
        !isValidCommittedRecordSnapshot(
          affectedRecord.recordState,
          affectedRecord.releaseId,
          parsed.data.content.revision,
          value.events
        ) ||
        !isAflTradeContentAddress(
          'outcome-release-record-state',
          affectedRecord.recordStateId,
          affectedRecord.recordState
        )
      ) {
        return invalidRegistry('A historical factual record-state commitment is invalid.');
      }
      latestRecordStateIds.set(affectedRecord.releaseId, affectedRecord.recordStateId);
    }
    const priorActiveReleaseId = replayedActiveByScope.get(parsed.data.content.scopeKey) ?? null;
    let nextActiveReleaseId = priorActiveReleaseId;
    if (parsed.data.content.action === 'activate') {
      nextActiveReleaseId = parsed.data.content.releaseId;
    } else if (
      parsed.data.content.action === 'withdraw' &&
      priorActiveReleaseId === parsed.data.content.releaseId
    ) {
      nextActiveReleaseId = null;
    }
    if (
      parsed.data.content.priorActiveReleaseId !== priorActiveReleaseId ||
      parsed.data.content.nextActiveReleaseId !== nextActiveReleaseId
    ) {
      return invalidRegistry('The factual registry pointer history is not replayable.');
    }
    if (nextActiveReleaseId === null) replayedActiveByScope.delete(parsed.data.content.scopeKey);
    else replayedActiveByScope.set(parsed.data.content.scopeKey, nextActiveReleaseId);
    previousEventId = parsed.data.eventId;
  }

  const publishedByScope = new Map<string, string>();
  for (const [releaseKey, candidate] of Object.entries(value.releases)) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return invalidRegistry('A factual release record is invalid.');
    }
    if (
      !hasExactOwnKeys(candidate, [
        'releaseId',
        'scopeKey',
        'state',
        'releaseManifest',
        'projectionManifest',
        'factualReviewDecisionId',
        'gate5DecisionId',
        'activationAuthorizationId',
        'events',
      ]) ||
      !gateDecisionIdSchema.nullable().safeParse(candidate.factualReviewDecisionId).success ||
      !gateDecisionIdSchema.nullable().safeParse(candidate.gate5DecisionId).success ||
      !z
        .string()
        .regex(/^outcome-activation-authorization:[a-f0-9]{64}$/)
        .nullable()
        .safeParse(candidate.activationAuthorizationId).success
    ) {
      return invalidRegistry('A factual release record envelope is invalid.');
    }
    const manifest = aflDraftTradeOutcomeReleaseManifestSchema.safeParse(candidate.releaseManifest);
    if (
      !manifest.success ||
      releaseKey !== candidate.releaseId ||
      candidate.releaseId !== manifest.data.releaseId ||
      candidate.scopeKey !== manifest.data.content.scopeKey ||
      !AFL_DRAFT_TRADE_OUTCOME_RELEASE_STATES.includes(candidate.state) ||
      !Array.isArray(candidate.events) ||
      candidate.events.length === 0
    ) {
      return invalidRegistry('A factual release record does not match its manifest identity.');
    }
    if (!hasValidReleaseEventHistory(candidate, value.revision)) {
      return invalidRegistry('A factual release event history is invalid.');
    }
    for (const eventCandidate of candidate.events) {
      const event = releaseEventSchema.safeParse(eventCandidate);
      if (!event.success) return invalidRegistry('A factual release event history is invalid.');
      const globalEvent = value.events[event.data.revision - 1]?.content;
      const globalMatchesRecord =
        globalEvent &&
        globalEvent.scopeKey === candidate.scopeKey &&
        globalEvent.occurredAt === event.data.occurredAt &&
        globalEvent.actor === event.data.actor &&
        globalEvent.evidenceId === event.data.evidenceId &&
        globalEvent.gateDecisionId === event.data.gateDecisionId;
      if (event.data.action === 'supersede') {
        if (
          !globalMatchesRecord ||
          globalEvent.action !== 'activate' ||
          globalEvent.priorActiveReleaseId !== candidate.releaseId ||
          globalEvent.nextActiveReleaseId !== globalEvent.releaseId
        ) {
          return invalidRegistry('A supersession event does not match its atomic activation.');
        }
      } else if (
        !globalMatchesRecord ||
        globalEvent.releaseId !== candidate.releaseId ||
        globalEvent.action !== event.data.action ||
        globalEvent.from !== event.data.from ||
        globalEvent.to !== event.data.to
      ) {
        return invalidRegistry('A release event does not match its global registry event.');
      }
    }
    if (candidate.events.at(-1)?.to !== candidate.state) {
      return invalidRegistry('A factual release state does not match its latest event.');
    }
    if (candidate.projectionManifest !== null) {
      if (
        !aflDraftTradeOutcomeProjectionManifestSchema.safeParse(candidate.projectionManifest)
          .success ||
        !validateAflDraftTradeOutcomeReleaseProjectionPair(
          manifest.data,
          candidate.projectionManifest
        )
      ) {
        return invalidRegistry('A factual release projection is invalid or mismatched.');
      }
    } else if (
      ['validated', 'approved', 'published', 'superseded', 'withdrawn'].includes(candidate.state)
    ) {
      return invalidRegistry('This factual release state requires an exact projection.');
    }
    if (
      ['approved', 'published', 'superseded', 'withdrawn'].includes(candidate.state) &&
      candidate.factualReviewDecisionId === null
    ) {
      return invalidRegistry('This factual release state requires a factual review decision.');
    }
    if (
      ['published', 'superseded', 'withdrawn'].includes(candidate.state) &&
      (candidate.gate5DecisionId === null || candidate.activationAuthorizationId === null)
    ) {
      return invalidRegistry(
        'This factual release state requires product and operational authority.'
      );
    }
    const currentCycleRevision =
      candidate.events.filter(({ action }) => action === 'validate').at(-1)?.revision ?? 0;
    const latestApproval = candidate.events
      .filter(({ action, revision }) => action === 'approve' && revision > currentCycleRevision)
      .at(-1);
    const latestActivation = candidate.events
      .filter(({ action, revision }) => action === 'activate' && revision > currentCycleRevision)
      .at(-1);
    const activationRegistryEvent = latestActivation
      ? value.events[latestActivation.revision - 1]?.content
      : null;
    if (
      candidate.factualReviewDecisionId !== (latestApproval?.gateDecisionId ?? null) ||
      candidate.gate5DecisionId !== (latestActivation?.gateDecisionId ?? null) ||
      candidate.activationAuthorizationId !==
        (activationRegistryEvent?.activationAuthorizationId ?? null)
    ) {
      return invalidRegistry('Stored factual authority does not match the release event history.');
    }
    if (candidate.state === 'published') {
      if (publishedByScope.has(candidate.scopeKey)) {
        return invalidRegistry('Only one factual release may be published per scope.');
      }
      publishedByScope.set(candidate.scopeKey, candidate.releaseId);
    }
    const expectedRecordStateId = latestRecordStateIds.get(candidate.releaseId);
    if (
      !expectedRecordStateId ||
      !isAflTradeContentAddress('outcome-release-record-state', expectedRecordStateId, candidate)
    ) {
      return invalidRegistry('A factual release record does not match the event-chain state.');
    }
  }

  if (latestRecordStateIds.size !== Object.keys(value.releases).length) {
    return invalidRegistry('The factual event chain references an unknown release record.');
  }

  for (const [scopeKey, pointer] of Object.entries(value.activeByScope)) {
    if (
      pointer === null ||
      typeof pointer !== 'object' ||
      Array.isArray(pointer) ||
      !hasExactOwnKeys(pointer, ['releaseId', 'activatedAt', 'revision']) ||
      !z.iso.datetime({ offset: true }).safeParse(pointer.activatedAt).success ||
      !Number.isInteger(pointer.revision) ||
      pointer.revision <= 0
    ) {
      return invalidRegistry('An active factual release pointer envelope is invalid.');
    }
    const record = value.releases[pointer.releaseId];
    const activationEvent = record?.events.filter(({ action }) => action === 'activate').at(-1);
    if (
      !record ||
      record.state !== 'published' ||
      record.scopeKey !== scopeKey ||
      pointer.revision > value.revision ||
      activationEvent?.revision !== pointer.revision ||
      activationEvent.occurredAt !== pointer.activatedAt ||
      publishedByScope.get(scopeKey) !== record.releaseId
    ) {
      return invalidRegistry('An active factual release pointer is invalid.');
    }
  }
  for (const [scopeKey, releaseId] of publishedByScope) {
    if (value.activeByScope[scopeKey]?.releaseId !== releaseId) {
      return invalidRegistry('A published factual release has no exact active pointer.');
    }
  }
  return value;
}

/**
 * Authenticates a registry snapshot loaded from a persistence boundary before it is exposed to
 * callers. Durable adapters must not treat a successfully decoded JSON value as trusted state.
 */
export function authenticateAflDraftTradeOutcomeReleaseRegistry(
  value: AflDraftTradeOutcomeReleaseRegistry
): AflDraftTradeOutcomeReleaseRegistry {
  return authenticateRegistry(value);
}

function appendRegistryEvent(
  previous: AflDraftTradeOutcomeReleaseRegistry,
  next: AflDraftTradeOutcomeReleaseRegistry,
  input: {
    action: AflDraftTradeOutcomeRegistryEventContent['action'];
    releaseId: string;
    scopeKey: string;
    occurredAt: string;
    actor: string;
    evidenceId: string;
    from: AflDraftTradeOutcomeReleaseState | null;
    to: AflDraftTradeOutcomeReleaseState;
    activationAuthorizationId?: string;
    gateDecisionId?: string;
  }
): AflDraftTradeOutcomeReleaseRegistry {
  const content: AflDraftTradeOutcomeRegistryEventContent = {
    schemaVersion: 'afl-draft-trade-outcome-registry-event/v1',
    revision: next.revision,
    previousEventId: previous.events.at(-1)?.eventId ?? null,
    action: input.action,
    releaseId: input.releaseId,
    scopeKey: input.scopeKey,
    occurredAt: input.occurredAt,
    actor: input.actor,
    evidenceId: input.evidenceId,
    from: input.from,
    to: input.to,
    priorActiveReleaseId: previous.activeByScope[input.scopeKey]?.releaseId ?? null,
    nextActiveReleaseId: next.activeByScope[input.scopeKey]?.releaseId ?? null,
    gateDecisionId: input.gateDecisionId ?? null,
    activationAuthorizationId: input.activationAuthorizationId ?? null,
    affectedRecordStates: Object.entries(next.releases)
      .filter(([releaseId, record]) => previous.releases[releaseId] !== record)
      .map(([releaseId, record]) => ({
        releaseId,
        recordStateId: createAflTradeContentAddress('outcome-release-record-state', record),
        recordState: record,
      }))
      .sort((left, right) => left.releaseId.localeCompare(right.releaseId)),
  };
  const event: AflDraftTradeOutcomeRegistryEvent = {
    eventId: createAflTradeContentAddress('outcome-release-event', content),
    content,
  };
  return authenticateRegistry({ ...next, events: [...previous.events, event] });
}

function requireExpectedRevision(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  expectedRevision: number
) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_COMMAND',
      'Expected revision must be a non-negative integer.'
    );
  }
  if (registry.revision !== expectedRevision) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'STALE_REVISION',
      `Expected registry revision ${expectedRevision}, found ${registry.revision}.`
    );
  }
}

function requireTimestamp(value: string) {
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_TIMESTAMP',
      'A valid timestamp with an offset is required.'
    );
  }
}

function requireMetadata(metadata: Omit<CommandMetadata, 'releaseId' | 'expectedRevision'>) {
  requireTimestamp(metadata.occurredAt);
  if (!metadata.actor.trim() || !immutableIdSchema.safeParse(metadata.evidenceId).success) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_COMMAND',
      'Release commands require an actor and evidence identifier.'
    );
  }
}

function appendEvent(
  record: AflDraftTradeOutcomeReleaseRecord,
  input: {
    revision: number;
    action: AflDraftTradeOutcomeReleaseEvent['action'];
    to: AflDraftTradeOutcomeReleaseState;
    occurredAt: string;
    actor: string;
    evidenceId: string;
    gateDecisionId?: string;
    reason?: string;
  }
): AflDraftTradeOutcomeReleaseRecord {
  requireMetadata(input);
  const previousEvent = record.events.at(-1);
  if (previousEvent && Date.parse(input.occurredAt) < Date.parse(previousEvent.occurredAt)) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'NON_MONOTONIC_EVENT',
      'Factual release events must be appended in chronological order.'
    );
  }
  return {
    ...record,
    state: input.to,
    events: [
      ...record.events,
      {
        revision: input.revision,
        action: input.action,
        from: record.state,
        to: input.to,
        occurredAt: input.occurredAt,
        actor: input.actor,
        evidenceId: input.evidenceId,
        gateDecisionId: input.gateDecisionId ?? null,
        reason: input.reason ?? null,
      },
    ],
  };
}

function requireRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  releaseId: string
): AflDraftTradeOutcomeReleaseRecord {
  const release = registry.releases[releaseId];
  if (!release) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'RELEASE_NOT_FOUND',
      `Factual release ${releaseId} does not exist.`
    );
  }
  return release;
}

function requireState(
  record: AflDraftTradeOutcomeReleaseRecord,
  allowed: readonly AflDraftTradeOutcomeReleaseState[],
  action: string
) {
  if (!allowed.includes(record.state)) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_TRANSITION',
      `Cannot ${action} factual release ${record.releaseId} from ${record.state}.`
    );
  }
}

function requireEnvironment(
  record: AflDraftTradeOutcomeReleaseRecord,
  environment: AflTradeDecisionEnvironment
) {
  if (record.releaseManifest.content.environment !== environment) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_COMMAND',
      'The command environment does not match the factual release.'
    );
  }
}

function requireEffectiveGateDecision(input: {
  ledger: AflTradeGateDecisionLedger;
  decisionId: string;
  gate: AflTradeGateCode;
  environment: AflTradeDecisionEnvironment;
  evaluatedAt: string;
  affectedArtifacts?: readonly AflTradeGovernedArtifactRef[];
}) {
  const decision = input.ledger.decisions.find(({ decisionId }) => decisionId === input.decisionId);
  if (!decision || decision.content.gate !== input.gate) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INEFFECTIVE_DECISION',
      `A current ${input.gate} decision is required.`
    );
  }
  const eligibility = resolveAflTradeGateEligibility(input.ledger, {
    gate: input.gate,
    decisionKey: decision.content.decisionKey,
    environment: input.environment,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    eligibility.status !== 'mechanically_eligible' ||
    eligibility.decision?.decisionId !== input.decisionId ||
    input.affectedArtifacts?.some(
      (required) =>
        !decision.content.affectedArtifacts.some(
          (actual) => actual.kind === required.kind && actual.artifactId === required.artifactId
        )
    )
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INEFFECTIVE_DECISION',
      `The ${input.gate} decision is ineffective or does not pin this factual release.`
    );
  }
}

function requireSourceRights(
  record: AflDraftTradeOutcomeReleaseRecord,
  input: {
    ledger: AflTradeGateDecisionLedger;
    environment: AflTradeDecisionEnvironment;
    evaluatedAt: string;
  }
) {
  if (record.releaseManifest.content.schemaVersion === 'afl-draft-trade-factual-release/v3') {
    for (const capture of record.releaseManifest.content.sourceCaptures) {
      const decision = input.ledger.decisions.find(
        ({ decisionId }) => decisionId === capture.gateDecisionId
      );
      if (
        decision === undefined ||
        decision.content.gate !== 'gate_0a_permission_to_evaluate' ||
        decision.content.environment !== input.environment ||
        !decision.content.affectedArtifacts.some(
          ({ kind, artifactId }) =>
            kind === 'source_rights' && artifactId === capture.rightsArtifactId
        )
      ) {
        throw new AflDraftTradeOutcomeReleaseStateError(
          'INEFFECTIVE_DECISION',
          'Every promotion-backed source capture requires its exact current Gate 0A decision.'
        );
      }
      const eligibility = resolveAflTradeGateEligibility(input.ledger, {
        gate: 'gate_0a_permission_to_evaluate',
        decisionKey: decision.content.decisionKey,
        environment: input.environment,
        evaluatedAt: input.evaluatedAt,
      });
      if (
        eligibility.status !== 'mechanically_eligible' ||
        eligibility.decision?.decisionId !== decision.decisionId
      ) {
        throw new AflDraftTradeOutcomeReleaseStateError(
          'INEFFECTIVE_DECISION',
          'A promotion-backed source decision is expired, withdrawn, or superseded.'
        );
      }
    }
    return;
  }
  for (const binding of record.releaseManifest.content.sourceRightsBindings) {
    const currentEvaluation = evaluateAflTradeGate0A(input.ledger, binding.sourceRightsProposal, {
      ...binding.gate0aReceipt.content.request,
      evaluatedAt: input.evaluatedAt,
    });
    if (
      currentEvaluation.status !== 'mechanically_eligible' ||
      currentEvaluation.decisionId !== binding.gateDecisionId ||
      currentEvaluation.rightsArtifactId !== binding.sourceRightsArtifactId
    ) {
      throw new AflDraftTradeOutcomeReleaseStateError(
        'INEFFECTIVE_DECISION',
        'The exact source terms, fields, uses, and Gate 0A decision must remain current.'
      );
    }
  }
}

function requireActivationAuthorization(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  record: AflDraftTradeOutcomeReleaseRecord,
  command: Extract<AflDraftTradeOutcomeReleaseCommand, { action: 'activate' }>
) {
  const parsed = aflDraftTradeOutcomeActivationAuthorizationSchema.safeParse(
    command.activationAuthorization
  );
  const projection = record.projectionManifest;
  const latestApproval = record.events.filter(({ action }) => action === 'approve').at(-1);
  if (
    !parsed.success ||
    !projection ||
    parsed.data.content.environment !== command.environment ||
    parsed.data.content.scopeKey !== record.scopeKey ||
    parsed.data.content.releaseId !== record.releaseId ||
    parsed.data.content.projectionId !== projection.projectionId ||
    parsed.data.content.expectedRegistryRevision !== registry.revision ||
    parsed.data.content.parityReportArtifactId !==
      projection.content.parityReport.artifact.artifactId ||
    Date.parse(parsed.data.content.authorizedAt) > Date.parse(command.occurredAt) ||
    Date.parse(command.occurredAt) >= Date.parse(parsed.data.content.expiresAt) ||
    Date.parse(command.occurredAt) >= Date.parse(parsed.data.content.rollbackWindowEndsAt) ||
    !latestApproval ||
    Date.parse(parsed.data.content.authorizedAt) < Date.parse(latestApproval.occurredAt)
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INEFFECTIVE_DECISION',
      'A current exact-revision operational authorization with an engaged write barrier is required.'
    );
  }
  return parsed.data;
}

export function registerAflDraftTradeOutcomeRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  input: {
    expectedRevision: number;
    manifest: AflDraftTradeOutcomeReleaseManifest;
    actor: string;
    evidenceId: string;
    occurredAt?: string;
  }
): AflDraftTradeOutcomeReleaseRegistry {
  authenticateRegistry(registry);
  requireExpectedRevision(registry, input.expectedRevision);
  const parsedManifest = aflDraftTradeOutcomeReleaseManifestSchema.safeParse(input.manifest);
  if (!parsedManifest.success) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'The factual release manifest is invalid.'
    );
  }
  const manifest = parsedManifest.data;
  const occurredAt = input.occurredAt ?? manifest.content.createdAt;
  if (
    (manifest.content.schemaVersion === 'afl-draft-trade-factual-release/v3' &&
      input.occurredAt === undefined) ||
    Date.parse(occurredAt) < Date.parse(manifest.content.createdAt)
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'Promotion-backed registration requires an explicit causal registration instant.'
    );
  }
  if (registry.releases[manifest.releaseId]) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'DUPLICATE_RELEASE',
      `Factual release ${manifest.releaseId} is already registered.`
    );
  }
  requireMetadata({
    occurredAt,
    actor: input.actor,
    evidenceId: input.evidenceId,
  });
  const revision = registry.revision + 1;
  const record: AflDraftTradeOutcomeReleaseRecord = {
    releaseId: manifest.releaseId,
    scopeKey: manifest.content.scopeKey,
    state: 'candidate',
    releaseManifest: manifest,
    projectionManifest: null,
    factualReviewDecisionId: null,
    gate5DecisionId: null,
    activationAuthorizationId: null,
    events: [
      {
        revision,
        action: 'register',
        from: null,
        to: 'candidate',
        occurredAt,
        actor: input.actor,
        evidenceId: input.evidenceId,
        gateDecisionId: null,
        reason: null,
      },
    ],
  };
  const next = {
    ...registry,
    revision,
    releases: { ...registry.releases, [record.releaseId]: record },
  };
  return appendRegistryEvent(registry, next, {
    action: 'register',
    releaseId: record.releaseId,
    scopeKey: record.scopeKey,
    occurredAt,
    actor: input.actor,
    evidenceId: input.evidenceId,
    from: null,
    to: 'candidate',
  });
}

function validateRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  record: AflDraftTradeOutcomeReleaseRecord,
  command: Extract<AflDraftTradeOutcomeReleaseCommand, { action: 'validate' }>
): AflDraftTradeOutcomeReleaseRegistry {
  requireState(record, ['candidate', 'superseded'], 'validate');
  requireEnvironment(record, command.environment);
  const parsedProjection = aflDraftTradeOutcomeProjectionManifestSchema.safeParse(
    command.projectionManifest
  );
  if (
    !parsedProjection.success ||
    !validateAflDraftTradeOutcomeReleaseProjectionPair(
      record.releaseManifest,
      parsedProjection.data
    ) ||
    Date.parse(command.occurredAt) < Date.parse(parsedProjection.data.content.createdAt)
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'Validation requires the exact downstream factual projection and passed parity evidence.'
    );
  }
  requireSourceRights(record, {
    ledger: command.gateDecisionLedger,
    environment: command.environment,
    evaluatedAt: command.occurredAt,
  });
  const revision = registry.revision + 1;
  const nextRecord = appendEvent(
    {
      ...record,
      projectionManifest: parsedProjection.data,
      factualReviewDecisionId: null,
      gate5DecisionId: null,
      activationAuthorizationId: null,
    },
    { ...command, revision, action: 'validate', to: 'validated' }
  );
  return {
    ...registry,
    revision,
    releases: { ...registry.releases, [record.releaseId]: nextRecord },
  };
}

function approveRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  record: AflDraftTradeOutcomeReleaseRecord,
  command: Extract<AflDraftTradeOutcomeReleaseCommand, { action: 'approve' }>
): AflDraftTradeOutcomeReleaseRegistry {
  requireState(record, ['validated'], 'approve');
  requireEnvironment(record, command.environment);
  if (!record.projectionManifest) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'A factual release cannot be approved without its validated projection.'
    );
  }
  requireEffectiveGateDecision({
    ledger: command.gateDecisionLedger,
    decisionId: command.gateDecisionId,
    gate: 'gate_4_publication_api_readiness',
    environment: command.environment,
    evaluatedAt: command.occurredAt,
    affectedArtifacts: [
      { kind: 'factual_release', artifactId: record.releaseId },
      { kind: 'factual_projection', artifactId: record.projectionManifest.projectionId },
    ],
  });
  const revision = registry.revision + 1;
  const nextRecord = appendEvent(
    { ...record, factualReviewDecisionId: command.gateDecisionId },
    {
      ...command,
      revision,
      action: 'approve',
      to: 'approved',
      gateDecisionId: command.gateDecisionId,
    }
  );
  return {
    ...registry,
    revision,
    releases: { ...registry.releases, [record.releaseId]: nextRecord },
  };
}

function activateRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  record: AflDraftTradeOutcomeReleaseRecord,
  command: Extract<AflDraftTradeOutcomeReleaseCommand, { action: 'activate' }>
): AflDraftTradeOutcomeReleaseRegistry {
  requireState(record, ['approved'], 'activate');
  requireEnvironment(record, command.environment);
  if (!record.projectionManifest || !record.factualReviewDecisionId) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'Activation requires a validated projection and factual review decision.'
    );
  }
  if (
    !validateAflDraftTradeOutcomeReleaseProjectionPair(
      record.releaseManifest,
      record.projectionManifest
    )
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_MANIFEST',
      'Activation requires the exact validated factual release and projection pair.'
    );
  }
  requireSourceRights(record, {
    ledger: command.sourceRightsDecisionLedger,
    environment: command.environment,
    evaluatedAt: command.occurredAt,
  });
  requireEffectiveGateDecision({
    ledger: command.factualReviewDecisionLedger,
    decisionId: record.factualReviewDecisionId,
    gate: 'gate_4_publication_api_readiness',
    environment: command.environment,
    evaluatedAt: command.occurredAt,
    affectedArtifacts: [
      { kind: 'factual_release', artifactId: record.releaseId },
      { kind: 'factual_projection', artifactId: record.projectionManifest.projectionId },
    ],
  });
  requireEffectiveGateDecision({
    ledger: command.gateDecisionLedger,
    decisionId: command.gateDecisionId,
    gate: 'gate_5_comprehension_accessibility',
    environment: command.environment,
    evaluatedAt: command.occurredAt,
    affectedArtifacts: [
      { kind: 'factual_release', artifactId: record.releaseId },
      { kind: 'factual_projection', artifactId: record.projectionManifest.projectionId },
    ],
  });
  const activationAuthorization = requireActivationAuthorization(registry, record, command);
  const revision = registry.revision + 1;
  const releases = { ...registry.releases };
  const activePointer = registry.activeByScope[record.scopeKey];
  if (activePointer && activePointer.releaseId !== record.releaseId) {
    const previous = requireRelease(registry, activePointer.releaseId);
    if (previous.scopeKey !== record.scopeKey || previous.state !== 'published') {
      throw new AflDraftTradeOutcomeReleaseStateError(
        'INVALID_ACTIVE_POINTER',
        'The existing factual pointer does not identify a published release in this scope.'
      );
    }
    releases[previous.releaseId] = appendEvent(previous, {
      revision,
      action: 'supersede',
      to: 'superseded',
      occurredAt: command.occurredAt,
      actor: command.actor,
      evidenceId: command.evidenceId,
      gateDecisionId: command.gateDecisionId,
      reason: `Superseded by ${record.releaseId}.`,
    });
  }
  releases[record.releaseId] = appendEvent(
    {
      ...record,
      gate5DecisionId: command.gateDecisionId,
      activationAuthorizationId: activationAuthorization.authorizationId,
    },
    {
      ...command,
      revision,
      action: 'activate',
      to: 'published',
      gateDecisionId: command.gateDecisionId,
    }
  );
  return {
    revision,
    releases,
    events: registry.events,
    activeByScope: {
      ...registry.activeByScope,
      [record.scopeKey]: {
        releaseId: record.releaseId,
        activatedAt: command.occurredAt,
        revision,
      },
    },
  };
}

function rejectOrWithdrawRelease(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  record: AflDraftTradeOutcomeReleaseRecord,
  command: Extract<AflDraftTradeOutcomeReleaseCommand, { action: 'reject' | 'withdraw' }>
): AflDraftTradeOutcomeReleaseRegistry {
  if (!command.reason?.trim()) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_COMMAND',
      `${command.action} requires a reason.`
    );
  }
  requireState(
    record,
    command.action === 'reject'
      ? ['candidate', 'validated', 'approved']
      : ['published', 'superseded'],
    command.action
  );
  const revision = registry.revision + 1;
  const targetState = command.action === 'reject' ? 'rejected' : 'withdrawn';
  const releases = {
    ...registry.releases,
    [record.releaseId]: appendEvent(record, {
      ...command,
      revision,
      action: command.action,
      to: targetState,
    }),
  };
  const activeByScope = { ...registry.activeByScope };
  if (
    command.action === 'withdraw' &&
    activeByScope[record.scopeKey]?.releaseId === record.releaseId
  ) {
    delete activeByScope[record.scopeKey];
  }
  return { revision, releases, activeByScope, events: registry.events };
}

export function applyAflDraftTradeOutcomeReleaseCommand(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  unparsedCommand: unknown
): AflDraftTradeOutcomeReleaseRegistry {
  authenticateRegistry(registry);
  const command = admitCommand(unparsedCommand);
  requireExpectedRevision(registry, command.expectedRevision);
  requireMetadata(command);
  const record = requireRelease(registry, command.releaseId);
  if (Date.parse(command.occurredAt) < Date.parse(record.releaseManifest.content.createdAt)) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'NON_MONOTONIC_EVENT',
      'A release command cannot predate its candidate manifest.'
    );
  }
  let next: AflDraftTradeOutcomeReleaseRegistry;
  if (command.action === 'validate') next = validateRelease(registry, record, command);
  else if (command.action === 'approve') next = approveRelease(registry, record, command);
  else if (command.action === 'activate') next = activateRelease(registry, record, command);
  else next = rejectOrWithdrawRelease(registry, record, command);
  const nextRecord = next.releases[record.releaseId];
  return appendRegistryEvent(registry, next, {
    action: command.action,
    releaseId: record.releaseId,
    scopeKey: record.scopeKey,
    occurredAt: command.occurredAt,
    actor: command.actor,
    evidenceId: command.evidenceId,
    from: record.state,
    to: nextRecord.state,
    ...(command.action === 'activate'
      ? { activationAuthorizationId: command.activationAuthorization.authorizationId }
      : {}),
    ...('gateDecisionId' in command ? { gateDecisionId: command.gateDecisionId } : {}),
  });
}

export function captureAflDraftTradeOutcomeReleaseSelection(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  scopeKey: string,
  evaluation: {
    evaluatedAt: string;
    sourceRightsDecisionLedger: AflTradeGateDecisionLedger;
  }
): AflDraftTradeOutcomeSelectionSnapshot {
  authenticateRegistry(registry);
  requireTimestamp(evaluation.evaluatedAt);
  const pointer = registry.activeByScope[scopeKey];
  if (!pointer) {
    return {
      registryRevision: registry.revision,
      selection: null,
      unavailabilityReason: 'no_active_release',
    };
  }
  const record = registry.releases[pointer.releaseId];
  if (
    !record ||
    record.scopeKey !== scopeKey ||
    record.state !== 'published' ||
    !record.projectionManifest ||
    pointer.revision > registry.revision ||
    !validateAflDraftTradeOutcomeReleaseProjectionPair(
      record.releaseManifest,
      record.projectionManifest
    )
  ) {
    throw new AflDraftTradeOutcomeReleaseStateError(
      'INVALID_ACTIVE_POINTER',
      'The active factual pointer is inconsistent with its exact release projection.'
    );
  }
  try {
    requireSourceRights(record, {
      ledger: evaluation.sourceRightsDecisionLedger,
      environment: record.releaseManifest.content.environment,
      evaluatedAt: evaluation.evaluatedAt,
    });
  } catch (error) {
    if (
      error instanceof AflDraftTradeOutcomeReleaseStateError &&
      error.code === 'INEFFECTIVE_DECISION'
    ) {
      return {
        registryRevision: registry.revision,
        selection: null,
        unavailabilityReason: 'source_blocked',
      };
    }
    throw error;
  }
  const content = record.releaseManifest.content;
  if (content.schemaVersion === 'afl-draft-trade-factual-release/v3') {
    return {
      registryRevision: registry.revision,
      selection: null,
      unavailabilityReason: 'no_active_release',
    };
  }
  return {
    registryRevision: registry.revision,
    selection: {
      registryRevision: registry.revision,
      scopeKey,
      environment: content.environment,
      release: {
        releaseId: record.releaseManifest.releaseId,
        projectionId: record.projectionManifest.projectionId,
        archiveDatasetId: content.archiveDatasetId,
        metricRegistryVersion: content.metricRegistryVersion,
        effectiveThrough: content.effectiveThrough,
        publishedAt: pointer.activatedAt,
      },
      metricDefinitions: content.metricDefinitions,
      supportedScope: content.supportedScope,
      excludedScope: content.excludedScope,
    },
  };
}

export function createAflDraftTradeOutcomeRegistryReleaseSelector(
  loadRegistry: () => Promise<AflDraftTradeOutcomeReleaseRegistry>,
  loadSourceRightsDecisionLedger: () => Promise<AflTradeGateDecisionLedger>,
  now: () => string,
  expectedEnvironment: AflTradeDecisionEnvironment
): AflDraftTradeOutcomeReleaseSelector {
  return {
    async capture(scopeKey) {
      const [registry, sourceRightsDecisionLedger] = await Promise.all([
        loadRegistry(),
        loadSourceRightsDecisionLedger(),
      ]);
      const snapshot = captureAflDraftTradeOutcomeReleaseSelection(registry, scopeKey, {
        evaluatedAt: now(),
        sourceRightsDecisionLedger,
      });
      if (snapshot.selection && snapshot.selection.environment !== expectedEnvironment) {
        throw new AflDraftTradeOutcomeReleaseStateError(
          'INVALID_ACTIVE_POINTER',
          `The active factual release belongs to ${snapshot.selection.environment}, not ${expectedEnvironment}.`
        );
      }
      return snapshot;
    },
  };
}
