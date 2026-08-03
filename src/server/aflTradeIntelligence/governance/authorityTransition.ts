import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_AUTHORITY_CONCERNS,
  type AflTradeAuthorityConcern,
} from './architectureCurrentState';

export const AFL_TRADE_AUTHORITY_TRANSITION_STATES = [
  'prepared',
  'activated',
  'rolled_back',
  'retired',
] as const;

const boundedTextSchema = z.string().trim().min(1).max(2000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const immutableReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });

const operationalAuthorizationSchema = z
  .object({
    decisionId: immutableReferenceSchema,
    evidenceId: immutableReferenceSchema,
    authorizedOperation: z.literal('transfer_authority'),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

const operatorAuthorizationSchema = z
  .object({
    operatorId: publicIdSchema,
    role: publicIdSchema,
    evidenceId: immutableReferenceSchema,
  })
  .strict();

const parityCheckpointSchema = z
  .object({
    status: z.literal('passed'),
    comparedAt: isoDateTimeSchema,
    evidenceIds: z.array(immutableReferenceSchema).min(1).max(100),
  })
  .strict();

const writeBarrierSchema = z
  .object({
    state: z.enum(['planned', 'engaged']),
    evidenceId: immutableReferenceSchema,
  })
  .strict();

export const aflTradeAuthorityTransitionEventContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-authority-transition/v1'),
    registryRevision: z.number().int().positive(),
    previousEventId: aflTradeContentAddressedIdSchema('authority-transition').nullable(),
    previousConcernEventId: aflTradeContentAddressedIdSchema('authority-transition').nullable(),
    transitionKey: publicIdSchema,
    concern: z.enum(AFL_TRADE_AUTHORITY_CONCERNS),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    state: z.enum(AFL_TRADE_AUTHORITY_TRANSITION_STATES),
    fromAuthority: boundedTextSchema,
    toAuthority: boundedTextSchema,
    architecturePackageId: aflTradeContentAddressedIdSchema('architecture-decision-package'),
    gate1DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    verificationMode: z.enum(['fixture', 'trusted_external_registry']),
    readinessEvidenceIds: z.array(immutableReferenceSchema).min(1).max(100),
    operationalAuthorization: operationalAuthorizationSchema,
    operatorAuthorization: operatorAuthorizationSchema,
    parityCheckpoint: parityCheckpointSchema,
    writeBarrier: writeBarrierSchema,
    rollbackWindowEndsAt: isoDateTimeSchema,
    occurredAt: isoDateTimeSchema,
    reason: boundedTextSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.concern === 'protected_fantasy_relational_state') {
      context.addIssue({
        code: 'custom',
        path: ['concern'],
        message:
          'Protected fantasy relational authority is outside the trade-engine transition boundary.',
      });
    }
    if (event.fromAuthority === event.toAuthority) {
      context.addIssue({
        code: 'custom',
        path: ['toAuthority'],
        message: 'Authority transitions require distinct source and target authorities.',
      });
    }
    if (event.verificationMode === 'fixture' && event.environment !== 'test_fixture') {
      context.addIssue({
        code: 'custom',
        path: ['verificationMode'],
        message: 'Fixture verification is valid only in the test-fixture environment.',
      });
    }
    if (Date.parse(event.operationalAuthorization.expiresAt) <= Date.parse(event.occurredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['operationalAuthorization', 'expiresAt'],
        message: 'Operational authorization must remain effective when the event occurs.',
      });
    }
    if (Date.parse(event.parityCheckpoint.comparedAt) > Date.parse(event.occurredAt)) {
      context.addIssue({
        code: 'custom',
        path: ['parityCheckpoint', 'comparedAt'],
        message: 'Parity evidence cannot be recorded after the transition event.',
      });
    }
    if (Date.parse(event.rollbackWindowEndsAt) <= Date.parse(event.occurredAt)) {
      if (event.state === 'prepared' || event.state === 'activated') {
        context.addIssue({
          code: 'custom',
          path: ['rollbackWindowEndsAt'],
          message: 'Preparation and activation require a future rollback window.',
        });
      }
    }
    if (event.state === 'prepared' && event.writeBarrier.state !== 'planned') {
      context.addIssue({
        code: 'custom',
        path: ['writeBarrier', 'state'],
        message: 'A prepared transition must record a planned write barrier.',
      });
    }
    if (
      (event.state === 'activated' || event.state === 'rolled_back') &&
      event.writeBarrier.state !== 'engaged'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['writeBarrier', 'state'],
        message: 'Activation and rollback events require an engaged write barrier.',
      });
    }
  });

export const aflTradeAuthorityTransitionEventSchema = z
  .object({
    eventId: aflTradeContentAddressedIdSchema('authority-transition'),
    content: aflTradeAuthorityTransitionEventContentSchema,
  })
  .strict()
  .superRefine((event, context) => {
    addAflTradeContentAddressIssue('authority-transition', event.eventId, event.content, context, [
      'eventId',
    ]);
  });

const initialAuthoritySchema = z
  .object({
    concern: z.enum(AFL_TRADE_AUTHORITY_CONCERNS),
    authority: boundedTextSchema,
    authorityEpoch: z.literal(1),
  })
  .strict();

export interface AflTradeAuthorityTransitionLedger {
  schemaVersion: 'afl-trade-authority-transition-ledger/v1';
  environment: 'test_fixture' | 'non_production' | 'production';
  currentStateSnapshotId: string;
  revision: number;
  initialAuthorities: readonly z.infer<typeof initialAuthoritySchema>[];
  events: readonly AflTradeAuthorityTransitionEvent[];
}

export type AflTradeAuthorityTransitionEvent = z.infer<
  typeof aflTradeAuthorityTransitionEventSchema
>;
export type AflTradeAuthorityTransitionState =
  (typeof AFL_TRADE_AUTHORITY_TRANSITION_STATES)[number];

export type AflTradeAuthorityTransitionIssueCode =
  | 'invalid_ledger_header'
  | 'trusted_evidence_verification_required'
  | 'invalid_initial_authorities'
  | 'invalid_event'
  | 'revision_mismatch'
  | 'event_chain_mismatch'
  | 'concern_chain_mismatch'
  | 'non_monotonic_event'
  | 'environment_mismatch'
  | 'duplicate_transition_key'
  | 'active_transition_exists'
  | 'transition_not_prepared'
  | 'transition_not_activated'
  | 'authority_mismatch'
  | 'transition_identity_mismatch'
  | 'write_barrier_mismatch'
  | 'rollback_window_closed'
  | 'retirement_before_rollback_window';

export interface AflTradeAuthorityTransitionIssue {
  code: AflTradeAuthorityTransitionIssueCode;
  eventId: string | null;
  message: string;
}

export interface AflTradeResolvedAuthority {
  concern: AflTradeAuthorityConcern;
  authority: string;
  authorityEpoch: number;
  establishedByEventId: string | null;
}

export interface AflTradeAuthorityTransitionValidation {
  valid: boolean;
  issues: AflTradeAuthorityTransitionIssue[];
  currentAuthorities: Readonly<Record<AflTradeAuthorityConcern, AflTradeResolvedAuthority>> | null;
}

interface ActiveTransition {
  state: 'prepared' | 'activated';
  event: AflTradeAuthorityTransitionEvent;
}

function addIssue(
  issues: AflTradeAuthorityTransitionIssue[],
  code: AflTradeAuthorityTransitionIssueCode,
  eventId: string | null,
  message: string
) {
  issues.push({ code, eventId, message });
}

function exactInitialAuthorities(
  initialAuthorities: readonly z.infer<typeof initialAuthoritySchema>[]
): boolean {
  const concerns = initialAuthorities.map((entry) => entry.concern);
  return (
    concerns.length === AFL_TRADE_AUTHORITY_CONCERNS.length &&
    new Set(concerns).size === concerns.length &&
    AFL_TRADE_AUTHORITY_CONCERNS.every((concern) => concerns.includes(concern))
  );
}

function sameTransitionIdentity(
  left: AflTradeAuthorityTransitionEvent,
  right: AflTradeAuthorityTransitionEvent
): boolean {
  return (
    left.content.transitionKey === right.content.transitionKey &&
    left.content.concern === right.content.concern &&
    left.content.fromAuthority === right.content.fromAuthority &&
    left.content.toAuthority === right.content.toAuthority &&
    left.content.architecturePackageId === right.content.architecturePackageId &&
    left.content.gate1DecisionId === right.content.gate1DecisionId &&
    left.content.verificationMode === right.content.verificationMode &&
    left.content.rollbackWindowEndsAt === right.content.rollbackWindowEndsAt
  );
}

interface TransitionValidationState {
  currentAuthorities: Record<AflTradeAuthorityConcern, AflTradeResolvedAuthority>;
  activeByConcern: Map<AflTradeAuthorityConcern, ActiveTransition>;
  transitionConcernByKey: Map<string, AflTradeAuthorityConcern>;
  lastEventByConcern: Map<AflTradeAuthorityConcern, string>;
  previousEvent: AflTradeAuthorityTransitionEvent | null;
}

function collectLedgerHeaderIssues(
  ledger: AflTradeAuthorityTransitionLedger
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  if (
    ledger.schemaVersion !== 'afl-trade-authority-transition-ledger/v1' ||
    !aflTradeContentAddressedIdSchema('architecture-current-state').safeParse(
      ledger.currentStateSnapshotId
    ).success
  ) {
    addIssue(issues, 'invalid_ledger_header', null, 'The authority ledger header is invalid.');
  }
  if (ledger.environment !== 'test_fixture') {
    addIssue(
      issues,
      'trusted_evidence_verification_required',
      null,
      'Non-fixture authority resolution requires a trusted evidence verifier that is not implemented.'
    );
  }
  return issues;
}

function validInitialAuthorities(ledger: AflTradeAuthorityTransitionLedger): boolean {
  return (
    z.array(initialAuthoritySchema).safeParse(ledger.initialAuthorities).success &&
    exactInitialAuthorities(ledger.initialAuthorities)
  );
}

function createTransitionValidationState(
  ledger: AflTradeAuthorityTransitionLedger
): TransitionValidationState {
  const currentAuthorities = Object.fromEntries(
    ledger.initialAuthorities.map((entry) => [
      entry.concern,
      { ...entry, establishedByEventId: null },
    ])
  ) as Record<AflTradeAuthorityConcern, AflTradeResolvedAuthority>;
  return {
    currentAuthorities,
    activeByConcern: new Map(),
    transitionConcernByKey: new Map(),
    lastEventByConcern: new Map(),
    previousEvent: null,
  };
}

function collectEventSequenceIssues(
  ledger: AflTradeAuthorityTransitionLedger,
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent,
  index: number
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  const { content } = event;
  if (content.registryRevision !== index + 1) {
    addIssue(
      issues,
      'revision_mismatch',
      event.eventId,
      'Event revisions must be contiguous and one-based.'
    );
  }
  const expectedPreviousEventId = state.previousEvent?.eventId ?? null;
  if (content.previousEventId !== expectedPreviousEventId) {
    addIssue(
      issues,
      'event_chain_mismatch',
      event.eventId,
      'The event does not extend the latest global ledger event.'
    );
  }
  const expectedConcernEventId = state.lastEventByConcern.get(content.concern) ?? null;
  if (content.previousConcernEventId !== expectedConcernEventId) {
    addIssue(
      issues,
      'concern_chain_mismatch',
      event.eventId,
      'The event does not extend the latest event for its authority concern.'
    );
  }
  if (
    state.previousEvent !== null &&
    Date.parse(content.occurredAt) < Date.parse(state.previousEvent.content.occurredAt)
  ) {
    addIssue(
      issues,
      'non_monotonic_event',
      event.eventId,
      'Authority events must be appended in chronological order.'
    );
  }
  if (content.environment !== ledger.environment) {
    addIssue(
      issues,
      'environment_mismatch',
      event.eventId,
      'Authority event and ledger environments must match.'
    );
  }
  return issues;
}

function applyPreparedTransition(
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  const { content } = event;
  const current = state.currentAuthorities[content.concern];
  const active = state.activeByConcern.get(content.concern);
  const existingTransitionConcern = state.transitionConcernByKey.get(content.transitionKey);
  if (active) {
    addIssue(
      issues,
      'active_transition_exists',
      event.eventId,
      'Only one transition may be active for an authority concern.'
    );
  }
  if (existingTransitionConcern !== undefined) {
    addIssue(
      issues,
      'duplicate_transition_key',
      event.eventId,
      `Transition key ${content.transitionKey} is already assigned to ${existingTransitionConcern}.`
    );
  }
  if (current.authority !== content.fromAuthority) {
    addIssue(
      issues,
      'authority_mismatch',
      event.eventId,
      'A transition must prepare from the current authority.'
    );
  }
  if (
    !active &&
    existingTransitionConcern === undefined &&
    current.authority === content.fromAuthority
  ) {
    state.activeByConcern.set(content.concern, { state: 'prepared', event });
    state.transitionConcernByKey.set(content.transitionKey, content.concern);
  }
  return issues;
}

function applyActivation(
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent,
  active: ActiveTransition
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  const { content } = event;
  const current = state.currentAuthorities[content.concern];
  if (active.state !== 'prepared') {
    addIssue(
      issues,
      'transition_not_prepared',
      event.eventId,
      'Only a prepared transition can be activated.'
    );
  } else if (current.authority !== content.fromAuthority) {
    addIssue(
      issues,
      'authority_mismatch',
      event.eventId,
      'Activation must replace the authority that was prepared.'
    );
  } else {
    state.currentAuthorities[content.concern] = {
      concern: content.concern,
      authority: content.toAuthority,
      authorityEpoch: current.authorityEpoch + 1,
      establishedByEventId: event.eventId,
    };
    state.activeByConcern.set(content.concern, { state: 'activated', event });
  }
  return issues;
}

function applyRollback(
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent,
  active: ActiveTransition
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  const { content } = event;
  const current = state.currentAuthorities[content.concern];
  if (active.state !== 'activated') {
    addIssue(
      issues,
      'transition_not_activated',
      event.eventId,
      'Only an activated transition can be rolled back.'
    );
  } else if (Date.parse(content.occurredAt) >= Date.parse(content.rollbackWindowEndsAt)) {
    addIssue(
      issues,
      'rollback_window_closed',
      event.eventId,
      'Rollback must occur within the declared rollback window.'
    );
  } else if (current.authority !== content.toAuthority) {
    addIssue(
      issues,
      'authority_mismatch',
      event.eventId,
      'Rollback requires the target to still be the current authority.'
    );
  } else {
    state.currentAuthorities[content.concern] = {
      concern: content.concern,
      authority: content.fromAuthority,
      authorityEpoch: current.authorityEpoch + 1,
      establishedByEventId: event.eventId,
    };
    state.activeByConcern.delete(content.concern);
  }
  return issues;
}

function applyRetirement(
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent,
  active: ActiveTransition
): AflTradeAuthorityTransitionIssue[] {
  const issues: AflTradeAuthorityTransitionIssue[] = [];
  const { content } = event;
  if (active.state === 'activated') {
    if (content.writeBarrier.state !== 'engaged') {
      addIssue(
        issues,
        'write_barrier_mismatch',
        event.eventId,
        'Retiring an activated transition requires the engaged write barrier.'
      );
    } else if (Date.parse(content.occurredAt) < Date.parse(content.rollbackWindowEndsAt)) {
      addIssue(
        issues,
        'retirement_before_rollback_window',
        event.eventId,
        'An activated transition cannot retire before its rollback window closes.'
      );
    } else {
      state.activeByConcern.delete(content.concern);
    }
  } else if (content.writeBarrier.state !== 'planned') {
    addIssue(
      issues,
      'write_barrier_mismatch',
      event.eventId,
      'Closing an unactivated preparation must not claim an engaged write barrier.'
    );
  } else {
    state.activeByConcern.delete(content.concern);
  }
  return issues;
}

function applyTransitionEvent(
  state: TransitionValidationState,
  event: AflTradeAuthorityTransitionEvent
): AflTradeAuthorityTransitionIssue[] {
  const { content } = event;
  if (content.state === 'prepared') return applyPreparedTransition(state, event);

  const active = state.activeByConcern.get(content.concern);
  if (!active || !sameTransitionIdentity(active.event, event)) {
    return [
      {
        code: 'transition_identity_mismatch',
        eventId: event.eventId,
        message: 'The event must continue the active transition identity.',
      },
    ];
  }
  if (content.state === 'activated') return applyActivation(state, event, active);
  if (content.state === 'rolled_back') return applyRollback(state, event, active);
  return applyRetirement(state, event, active);
}

function malformedEventId(rawEvent: unknown): string | null {
  return typeof rawEvent === 'object' && rawEvent !== null && 'eventId' in rawEvent
    ? String(rawEvent.eventId)
    : null;
}

export function validateAflTradeAuthorityTransitionLedger(
  ledger: AflTradeAuthorityTransitionLedger
): AflTradeAuthorityTransitionValidation {
  const issues = collectLedgerHeaderIssues(ledger);
  if (!validInitialAuthorities(ledger)) {
    addIssue(
      issues,
      'invalid_initial_authorities',
      null,
      'The ledger requires exactly one initial authority for every concern.'
    );
    return { valid: false, issues, currentAuthorities: null };
  }
  if (ledger.revision !== ledger.events.length) {
    addIssue(
      issues,
      'revision_mismatch',
      null,
      'The registry revision must equal the append-only event count.'
    );
  }

  const state = createTransitionValidationState(ledger);
  for (const [index, rawEvent] of ledger.events.entries()) {
    const parsedEvent = aflTradeAuthorityTransitionEventSchema.safeParse(rawEvent);
    if (!parsedEvent.success) {
      addIssue(
        issues,
        'invalid_event',
        malformedEventId(rawEvent),
        `Event at revision ${index + 1} is invalid.`
      );
      continue;
    }
    const event = parsedEvent.data;
    issues.push(...collectEventSequenceIssues(ledger, state, event, index));
    issues.push(...applyTransitionEvent(state, event));
    state.previousEvent = event;
    state.lastEventByConcern.set(event.content.concern, event.eventId);
  }

  return {
    valid: issues.length === 0,
    issues,
    currentAuthorities: issues.length === 0 ? state.currentAuthorities : null,
  };
}

export function createAflTradeAuthorityTransitionLedger(input: {
  environment: AflTradeAuthorityTransitionLedger['environment'];
  currentStateSnapshotId: string;
  initialAuthorities: AflTradeAuthorityTransitionLedger['initialAuthorities'];
}): AflTradeAuthorityTransitionLedger {
  const ledger: AflTradeAuthorityTransitionLedger = {
    schemaVersion: 'afl-trade-authority-transition-ledger/v1',
    environment: input.environment,
    currentStateSnapshotId: input.currentStateSnapshotId,
    revision: 0,
    initialAuthorities: input.initialAuthorities,
    events: [],
  };
  const validation = validateAflTradeAuthorityTransitionLedger(ledger);
  if (!validation.valid) {
    throw new AflTradeAuthorityTransitionError(
      'INVALID_LEDGER',
      validation.issues.map((issue) => issue.message).join(' ')
    );
  }
  return ledger;
}

export interface AflTradeAuthorityTransitionCommand {
  expectedRevision: number;
  transitionKey: string;
  concern: AflTradeAuthorityConcern;
  state: AflTradeAuthorityTransitionState;
  fromAuthority: string;
  toAuthority: string;
  architecturePackageId: string;
  gate1DecisionId: string;
  verificationMode: 'fixture' | 'trusted_external_registry';
  readinessEvidenceIds: string[];
  operationalAuthorization: z.infer<typeof operationalAuthorizationSchema>;
  operatorAuthorization: z.infer<typeof operatorAuthorizationSchema>;
  parityCheckpoint: z.infer<typeof parityCheckpointSchema>;
  writeBarrier: z.infer<typeof writeBarrierSchema>;
  rollbackWindowEndsAt: string;
  occurredAt: string;
  reason: string;
}

export type AflTradeAuthorityTransitionErrorCode =
  'STALE_REVISION' | 'INVALID_LEDGER' | 'INVALID_TRANSITION' | 'PROTECTED_AUTHORITY_BOUNDARY';

export class AflTradeAuthorityTransitionError extends Error {
  constructor(
    public readonly code: AflTradeAuthorityTransitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeAuthorityTransitionError';
  }
}

export function appendAflTradeAuthorityTransition(
  ledger: AflTradeAuthorityTransitionLedger,
  command: AflTradeAuthorityTransitionCommand
): AflTradeAuthorityTransitionLedger {
  const existingValidation = validateAflTradeAuthorityTransitionLedger(ledger);
  if (!existingValidation.valid) {
    throw new AflTradeAuthorityTransitionError(
      'INVALID_LEDGER',
      'Cannot append to an invalid ledger.'
    );
  }
  if (command.concern === 'protected_fantasy_relational_state') {
    throw new AflTradeAuthorityTransitionError(
      'PROTECTED_AUTHORITY_BOUNDARY',
      'Protected fantasy relational authority cannot be transferred by the trade engine.'
    );
  }
  if (command.expectedRevision !== ledger.revision) {
    throw new AflTradeAuthorityTransitionError(
      'STALE_REVISION',
      `Expected authority revision ${command.expectedRevision}, received ${ledger.revision}.`
    );
  }
  const previousEvent = ledger.events.at(-1) ?? null;
  const previousConcernEvent = [...ledger.events]
    .reverse()
    .find((event) => event.content.concern === command.concern);
  const parsedContent = aflTradeAuthorityTransitionEventContentSchema.safeParse({
    schemaVersion: 'afl-trade-authority-transition/v1',
    registryRevision: ledger.revision + 1,
    previousEventId: previousEvent?.eventId ?? null,
    previousConcernEventId: previousConcernEvent?.eventId ?? null,
    environment: ledger.environment,
    transitionKey: command.transitionKey,
    concern: command.concern,
    state: command.state,
    fromAuthority: command.fromAuthority,
    toAuthority: command.toAuthority,
    architecturePackageId: command.architecturePackageId,
    gate1DecisionId: command.gate1DecisionId,
    verificationMode: command.verificationMode,
    readinessEvidenceIds: command.readinessEvidenceIds,
    operationalAuthorization: command.operationalAuthorization,
    operatorAuthorization: command.operatorAuthorization,
    parityCheckpoint: command.parityCheckpoint,
    writeBarrier: command.writeBarrier,
    rollbackWindowEndsAt: command.rollbackWindowEndsAt,
    occurredAt: command.occurredAt,
    reason: command.reason,
  });
  if (!parsedContent.success) {
    throw new AflTradeAuthorityTransitionError(
      'INVALID_TRANSITION',
      'The authority-transition command is invalid.'
    );
  }
  const content = parsedContent.data;
  const parsedEvent = aflTradeAuthorityTransitionEventSchema.safeParse({
    eventId: createAflTradeContentAddress('authority-transition', content),
    content,
  });
  if (!parsedEvent.success) {
    throw new AflTradeAuthorityTransitionError(
      'INVALID_TRANSITION',
      'The authority-transition event is invalid.'
    );
  }
  const event = parsedEvent.data;
  const candidate = {
    ...ledger,
    revision: ledger.revision + 1,
    events: [...ledger.events, event],
  };
  const validation = validateAflTradeAuthorityTransitionLedger(candidate);
  if (!validation.valid) {
    throw new AflTradeAuthorityTransitionError(
      'INVALID_TRANSITION',
      validation.issues.map((issue) => issue.message).join(' ')
    );
  }
  return candidate;
}
