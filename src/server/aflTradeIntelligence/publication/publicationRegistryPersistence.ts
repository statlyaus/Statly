import {
  AFL_TRADE_PUBLICATION_STATES,
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence/value';
import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
  type AflTradeProjectionManifest,
  type AflTradePublicationManifest,
} from '../artifacts/manifestContracts';
import type {
  AflTradeActivePublicationPointer,
  AflTradePublicationRecord,
  AflTradePublicationRegistry,
} from './publicationState';

const publicationEventSchema = z
  .object({
    from: z.enum(AFL_TRADE_PUBLICATION_STATES).nullable(),
    to: z.enum(AFL_TRADE_PUBLICATION_STATES),
    occurredAt: aflTradeIsoDateTimeSchema,
    actor: z.string().trim().min(1).max(200),
    evidenceId: aflTradePublicIdSchema,
    reason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

const publicationRecordSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    publicationManifestSchemaVersion: z.enum([
      'afl-trade-publication/v2',
      'afl-trade-publication/v3',
      'afl-trade-publication/v4',
    ]),
    scopeKey: aflTradePublicIdSchema,
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valueUnitId: aflTradePublicIdSchema,
    supportedViews: z.array(z.enum(AFL_TRADE_VALUATION_VIEWS)).min(1),
    supportedCohorts: z.array(aflTradePublicIdSchema),
    excludedCohorts: z.array(aflTradePublicIdSchema),
    manifestContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(AFL_TRADE_PUBLICATION_STATES),
    createdAt: aflTradeIsoDateTimeSchema,
    projectionId: aflTradeContentAddressedIdSchema('projection').nullable(),
    gate4DecisionId: aflTradeContentAddressedIdSchema('gate-decision').nullable(),
    gate5DecisionId: aflTradeContentAddressedIdSchema('gate-decision').nullable(),
    events: z.array(publicationEventSchema).min(1),
  })
  .strict();

const activePointerSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    activatedAt: aflTradeIsoDateTimeSchema,
    revision: z.number().int().positive(),
  })
  .strict();

const registrySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    publications: z.record(
      aflTradeContentAddressedIdSchema('publication'),
      publicationRecordSchema
    ),
    activeByScope: z.record(aflTradePublicIdSchema, activePointerSchema),
  })
  .strict();

export const aflTradePublicationPersistenceEventContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication-persistence-event/v1'),
    revision: z.number().int().positive(),
    previousEventId: aflTradeContentAddressedIdSchema('publication-event').nullable(),
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    action: z.enum(['register', 'validate', 'approve', 'publish', 'reject', 'withdraw']),
    occurredAt: aflTradeIsoDateTimeSchema,
    changedRecords: z.array(publicationRecordSchema).min(1).max(2),
    activeScopeKey: aflTradePublicIdSchema,
    activePointerAfter: activePointerSchema.nullable(),
  })
  .strict();

export const aflTradePublicationPersistenceEventSchema = z
  .object({
    eventId: aflTradeContentAddressedIdSchema('publication-event'),
    content: aflTradePublicationPersistenceEventContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eventId !== createAflTradeContentAddress('publication-event', value.content)) {
      context.addIssue({
        code: 'custom',
        path: ['eventId'],
        message: 'Publication event identity must match its canonical content.',
      });
    }
  });

export type AflTradePublicationPersistenceEvent = z.infer<
  typeof aflTradePublicationPersistenceEventSchema
>;

export interface AflTradeProjectionArtifactBinding {
  manifest: AflTradeProjectionManifest;
  artifactId: string;
}

export interface AflTradePublicationRegistryPersistenceInput {
  headRegistry: unknown;
  publicationManifests: readonly unknown[];
  projectionBindings: readonly AflTradeProjectionArtifactBinding[];
  events: readonly unknown[];
  activePointers: readonly ({ scopeKey: string } & AflTradeActivePublicationPointer)[];
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function fail(message: string): never {
  throw new TypeError(message);
}

function changedRecords(
  previous: AflTradePublicationRegistry,
  next: AflTradePublicationRegistry
): AflTradePublicationRecord[] {
  const keys = new Set([...Object.keys(previous.publications), ...Object.keys(next.publications)]);
  return [...keys]
    .filter((key) => {
      const before = previous.publications[key];
      const after = next.publications[key];
      return before === undefined || after === undefined || !exact(before, after);
    })
    .map((key) => next.publications[key] ?? fail('Publication records cannot be deleted.'))
    .sort((left, right) => left.publicationId.localeCompare(right.publicationId));
}

function requireManifestParity(
  record: AflTradePublicationRecord,
  manifest: AflTradePublicationManifest
): void {
  if (
    record.publicationId !== manifest.publicationId ||
    record.publicationManifestSchemaVersion !== manifest.content.schemaVersion ||
    record.scopeKey !== manifest.content.scopeKey ||
    record.valuationBundleId !== manifest.content.valuationBundleId ||
    record.valueUnitId !== manifest.content.valueUnitId ||
    record.createdAt !== manifest.content.createdAt ||
    record.manifestContentSha256 !== manifest.publicationId.slice('publication:'.length) ||
    !exact(record.supportedViews, manifest.content.supportedViews) ||
    !exact(record.supportedCohorts, manifest.content.supportedCohorts) ||
    !exact(record.excludedCohorts, manifest.content.excludedCohorts)
  ) {
    fail('A persisted publication record does not match its immutable manifest.');
  }
}

export function createAflTradePublicationPersistenceEvent(input: {
  previousRegistry: AflTradePublicationRegistry;
  nextRegistry: AflTradePublicationRegistry;
  previousEventId: string | null;
  publicationId: string;
  action: AflTradePublicationPersistenceEvent['content']['action'];
}): AflTradePublicationPersistenceEvent {
  const previous = registrySchema.parse(input.previousRegistry);
  const next = registrySchema.parse(input.nextRegistry);
  if (next.revision !== previous.revision + 1) {
    fail('A publication persistence event must advance exactly one registry revision.');
  }
  const target = next.publications[input.publicationId];
  if (target === undefined) fail('The publication persistence event target is unavailable.');
  const changes = changedRecords(previous, next);
  if (!changes.some((record) => record.publicationId === target.publicationId)) {
    fail('The publication persistence event must change its target record.');
  }
  const latest = target.events.at(-1);
  const expectedState = {
    register: 'candidate',
    validate: 'validated',
    approve: 'approved',
    publish: 'published',
    reject: 'rejected',
    withdraw: 'withdrawn',
  }[input.action];
  if (latest === undefined || latest.to !== expectedState) {
    fail('The publication persistence action does not match the canonical target transition.');
  }
  for (const [scopeKey, pointer] of Object.entries(previous.activeByScope)) {
    if (scopeKey !== target.scopeKey && !exact(pointer, next.activeByScope[scopeKey])) {
      fail('A publication event cannot alter an unrelated active scope.');
    }
  }
  const content = aflTradePublicationPersistenceEventContentSchema.parse({
    schemaVersion: 'afl-trade-publication-persistence-event/v1',
    revision: next.revision,
    previousEventId: input.previousEventId,
    publicationId: target.publicationId,
    action: input.action,
    occurredAt: latest.occurredAt,
    changedRecords: changes,
    activeScopeKey: target.scopeKey,
    activePointerAfter: next.activeByScope[target.scopeKey] ?? null,
  });
  return aflTradePublicationPersistenceEventSchema.parse({
    eventId: createAflTradeContentAddress('publication-event', content),
    content,
  });
}

export function authenticateAflTradePublicationRegistryPersistence(
  input: AflTradePublicationRegistryPersistenceInput
): AflTradePublicationRegistry {
  const head = registrySchema.parse(input.headRegistry);
  const manifests = input.publicationManifests.map((value) =>
    aflTradePublicationManifestSchema.parse(value)
  );
  const manifestById = new Map(manifests.map((manifest) => [manifest.publicationId, manifest]));
  const projections = input.projectionBindings.map(({ manifest, artifactId }) => ({
    manifest: aflTradeProjectionManifestSchema.parse(manifest),
    artifactId: aflTradeContentAddressedIdSchema('artifact').parse(artifactId),
  }));
  const projectionById = new Map(
    projections.map((binding) => [binding.manifest.projectionId, binding])
  );
  let rebuilt: AflTradePublicationRegistry = {
    revision: 0,
    publications: {},
    activeByScope: {},
  };
  let previousEventId: string | null = null;

  input.events.forEach((unparsedEvent, index) => {
    const event = aflTradePublicationPersistenceEventSchema.parse(unparsedEvent);
    if (event.content.revision !== index + 1 || event.content.previousEventId !== previousEventId) {
      fail('The publication event chain is not contiguous.');
    }
    const publications = { ...rebuilt.publications };
    for (const record of event.content.changedRecords) publications[record.publicationId] = record;
    const activeByScope = { ...rebuilt.activeByScope };
    if (event.content.activePointerAfter === null)
      delete activeByScope[event.content.activeScopeKey];
    else activeByScope[event.content.activeScopeKey] = event.content.activePointerAfter;
    const next = { revision: event.content.revision, publications, activeByScope };
    const expected = createAflTradePublicationPersistenceEvent({
      previousRegistry: rebuilt,
      nextRegistry: next,
      previousEventId,
      publicationId: event.content.publicationId,
      action: event.content.action,
    });
    if (!exact(expected, event)) fail('The publication event is not a canonical state transition.');
    rebuilt = next;
    previousEventId = event.eventId;
  });

  if (!exact(rebuilt, head)) fail('The registry head does not match its immutable event chain.');
  if (
    head.revision !== input.events.length ||
    manifestById.size !== Object.keys(head.publications).length
  ) {
    fail('The publication registry does not have exact manifest and event closure.');
  }
  for (const record of Object.values(head.publications)) {
    const manifest = manifestById.get(record.publicationId);
    if (manifest === undefined) fail('A publication manifest is missing.');
    requireManifestParity(record, manifest);
    if (record.projectionId !== null) {
      const binding = projectionById.get(record.projectionId);
      if (binding?.manifest.content.publicationId !== record.publicationId) {
        fail('A publication projection binding is missing or belongs to another publication.');
      }
    }
  }
  const storedPointers = Object.fromEntries(
    input.activePointers.map(({ scopeKey, ...pointer }) => [
      scopeKey,
      activePointerSchema.parse(pointer),
    ])
  );
  if (!exact(storedPointers, head.activeByScope))
    fail('The active pointer rows do not match the registry head.');
  return head;
}
