import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflDraftTradeOutcomeReleaseManifest,
  validateAflDraftTradeOutcomeReleaseProjectionPair,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  AflDraftTradeOutcomeReleaseStateError,
  applyAflDraftTradeOutcomeReleaseCommand,
  captureAflDraftTradeOutcomeReleaseSelection,
  createAflDraftTradeOutcomeRegistryReleaseSelector,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
  type AflDraftTradeOutcomeReleaseRegistry,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import {
  AflDraftTradeOutcomeReleaseRepositoryError,
  InMemoryAflDraftTradeOutcomeRegistrySnapshotStore,
  createAflDraftTradeOutcomeReleaseRepository,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseRepository';
import {
  PostgresAflDraftTradeOutcomeRegistrySnapshotStore,
  createPostgresAflDraftTradeOutcomeReleaseRepository,
  type AflOutcomeSqlClient,
  type AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { aflTradeGate0AReceiptSchema } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import {
  activateAflDraftTradeOutcomeReleaseFixture as activateFixture,
  aflDraftTradeOutcomeFixtureHash as hash,
  createAflDraftTradeOutcomeActivationAuthorizationFixture as activationAuthorization,
  createAflDraftTradeOutcomeReleaseFixture as fixture,
  createAflDraftTradeOutcomeSelectionEvaluationFixture as selectionEvaluation,
  registerAflDraftTradeOutcomeReleaseFixture as register,
} from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

describe('AFL Draft & Trade factual release contracts', () => {
  it('content-addresses exact release and projection evidence and rejects drift', () => {
    const { release, projection } = fixture('a');
    expect(release.releaseId).toMatch(/^outcome-release:[a-f0-9]{64}$/);
    expect(projection.projectionId).toMatch(/^outcome-projection:[a-f0-9]{64}$/);
    expect(validateAflDraftTradeOutcomeReleaseProjectionPair(release, projection)).toBe(true);
    expect(
      validateAflDraftTradeOutcomeReleaseProjectionPair(release, {
        ...projection,
        content: { ...projection.content, documentCount: 13 },
      })
    ).toBe(false);
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        scopeKey: 'fantasy:league-owned-outcomes',
      })
    ).toThrow();
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        excludedScope: [release.content.supportedScope[0]],
      })
    ).toThrow();

    const sourceBinding = release.content.sourceRightsBindings[0];
    const narrowedReceiptContent = {
      ...sourceBinding.gate0aReceipt.content,
      request: {
        ...sourceBinding.gate0aReceipt.content.request,
        fieldUses: sourceBinding.gate0aReceipt.content.request.fieldUses.map((fieldUse) =>
          fieldUse.sourceField === 'goals'
            ? { ...fieldUse, use: 'derived_feature' as const }
            : fieldUse
        ),
      },
    };
    const narrowedReceipt = aflTradeGate0AReceiptSchema.parse({
      receiptId: createAflTradeContentAddress('gate0a-evaluation', narrowedReceiptContent),
      content: narrowedReceiptContent,
    });
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        sourceRightsBindings: [{ ...sourceBinding, gate0aReceipt: narrowedReceipt }],
      })
    ).toThrow();
  });
});

describe('AFL Draft & Trade factual release lifecycle', () => {
  it('keeps candidates inactive and rejects stale registration without mutation', () => {
    const value = fixture('a');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        value.release.content.scopeKey,
        selectionEvaluation(value)
      )
    ).toEqual({
      registryRevision: 1,
      selection: null,
      unavailabilityReason: 'no_active_release',
    });
    const original = structuredClone(registry);
    expect(() =>
      registerAflDraftTradeOutcomeRelease(registry, {
        expectedRevision: 0,
        manifest: fixture('b').release,
        actor: 'stale-importer',
        evidenceId: `artifact:${hash('f')}`,
      })
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
    expect(registry).toEqual(original);
  });

  it('activates one exact release selection and rejects a concurrent stale winner', async () => {
    const first = fixture('a');
    let registry = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    registry = activateFixture(registry, first, 3);
    const snapshot = captureAflDraftTradeOutcomeReleaseSelection(
      registry,
      AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      selectionEvaluation(first)
    );
    expect(snapshot).toMatchObject({
      registryRevision: 4,
      selection: {
        registryRevision: 4,
        release: {
          releaseId: first.release.releaseId,
          projectionId: first.projection.projectionId,
          archiveDatasetId: first.release.content.archiveDatasetId,
          publishedAt: '2026-08-06T05:00:00.000Z',
        },
      },
    });
    const selector = createAflDraftTradeOutcomeRegistryReleaseSelector(
      async () => registry,
      async () => first.rights.ledger,
      () => '2026-08-06T13:00:00.000Z',
      'test_fixture'
    );
    await expect(selector.capture(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE)).resolves.toEqual(snapshot);
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first, '2027-01-01T00:00:00.000Z')
      )
    ).toEqual({
      registryRevision: 4,
      selection: null,
      unavailabilityReason: 'source_blocked',
    });

    const original = structuredClone(registry);
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'withdraw',
        releaseId: first.release.releaseId,
        expectedRevision: 3,
        occurredAt: '2026-08-06T06:00:00.000Z',
        actor: 'stale-operator',
        evidenceId: `artifact:${hash('f')}`,
        reason: 'Fabricated concurrent withdrawal.',
      })
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
    expect(registry).toEqual(original);
  });

  it('rechecks source rights at activation rather than relying on earlier validation', () => {
    const value = fixture('c', '2026-08-06T04:30:00.000Z');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(() => activateFixture(registry, value, 3)).toThrow(
      expect.objectContaining({ code: 'INEFFECTIVE_DECISION' })
    );
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        value.release.content.scopeKey,
        selectionEvaluation(value)
      )
    ).toEqual({
      registryRevision: 1,
      selection: null,
      unavailabilityReason: 'no_active_release',
    });

    const expiredTerms = fixture('c', undefined, '2026-08-06T04:30:00.000Z');
    const termsRegistry = register(
      createAflDraftTradeOutcomeReleaseRegistry(),
      expiredTerms.release
    );
    expect(() => activateFixture(termsRegistry, expiredTerms, 3)).toThrow(
      expect.objectContaining({ code: 'INEFFECTIVE_DECISION' })
    );
  });

  it('rechecks factual review and operational authorization at activation', () => {
    const value = fixture('d');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(() =>
      activateFixture(registry, value, 3, {
        reviewRevalidateAt: '2026-08-06T04:30:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
    expect(() =>
      activateFixture(registry, value, 3, {
        authorizationExpiresAt: '2026-08-06T04:45:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
    expect(() =>
      activateFixture(registry, value, 3, {
        rollbackWindowEndsAt: '2026-08-06T04:45:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
  });

  it('strictly rejects unknown and accessor command envelopes without mutation', () => {
    const value = fixture('e');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    const original = structuredClone(registry);
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'erase',
        releaseId: value.release.releaseId,
        expectedRevision: registry.revision,
        occurredAt: '2026-08-06T03:00:00.000Z',
        actor: 'fixture-operator',
        evidenceId: `artifact:${hash('e')}`,
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));

    let invocationCount = 0;
    const accessor = {
      releaseId: value.release.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-06T03:00:00.000Z',
      actor: 'fixture-operator',
      evidenceId: `artifact:${hash('e')}`,
    };
    Object.defineProperty(accessor, 'action', {
      enumerable: true,
      get() {
        invocationCount += 1;
        return 'withdraw';
      },
    });
    expect(() => applyAflDraftTradeOutcomeReleaseCommand(registry, accessor)).toThrow(
      expect.objectContaining({ code: 'INVALID_COMMAND' })
    );
    expect(invocationCount).toBe(0);
    expect(registry).toEqual(original);
  });

  it('atomically supersedes, withdraws without fallback, and requires fresh recovery', () => {
    const first = fixture('a');
    const second = fixture('b');
    let registry = createAflDraftTradeOutcomeReleaseRegistry();
    registry = register(registry, first.release);
    registry = activateFixture(registry, first, 3);
    registry = register(registry, second.release);
    registry = activateFixture(registry, second, 6);
    expect(registry.releases[first.release.releaseId].state).toBe('superseded');
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(second)
      ).selection?.release.releaseId
    ).toBe(second.release.releaseId);

    registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
      action: 'withdraw',
      releaseId: second.release.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-06T09:30:00.000Z',
      actor: 'fixture-operator',
      evidenceId: `artifact:${hash('f')}`,
      reason: 'Fabricated source-rights incident.',
    });
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(second)
      )
    ).toEqual({
      registryRevision: registry.revision,
      selection: null,
      unavailabilityReason: 'no_active_release',
    });
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'activate',
        releaseId: first.release.releaseId,
        expectedRevision: registry.revision,
        occurredAt: '2026-08-06T10:00:00.000Z',
        actor: 'fixture-operator',
        evidenceId: `artifact:${hash('d')}`,
        environment: 'test_fixture',
        gateDecisionId: `gate-decision:${hash('d')}`,
        gateDecisionLedger: { proposals: [], decisions: [] },
        sourceRightsDecisionLedger: first.rights.ledger,
        factualReviewDecisionLedger: { proposals: [], decisions: [] },
        activationAuthorization: activationAuthorization(
          first,
          registry.revision,
          '2026-08-06T09:45:00.000Z',
          '2026-08-06T11:00:00.000Z',
          `artifact:${hash('d')}`
        ),
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));

    registry = activateFixture(registry, first, 10);
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      ).selection?.release
    ).toMatchObject({
      releaseId: first.release.releaseId,
      publishedAt: '2026-08-06T12:00:00.000Z',
    });
  });

  it('fails closed when the active pointer is inconsistent', () => {
    const first = fixture('a');
    let registry = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    registry = activateFixture(registry, first, 3);
    const corrupted = {
      ...registry,
      releases: {
        ...registry.releases,
        [first.release.releaseId]: {
          ...registry.releases[first.release.releaseId],
          state: 'withdrawn' as const,
        },
      },
    };
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        corrupted,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(AflDraftTradeOutcomeReleaseStateError);

    expect(registry.events).toHaveLength(registry.revision);
    expect(registry.events.at(-1)?.eventId).toMatch(/^outcome-release-event:[a-f0-9]{64}$/);
    const tamperedEventChain = structuredClone(registry);
    tamperedEventChain.events[0].content.actor = 'tampered-actor';
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        tamperedEventChain,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const forgedScope = structuredClone(registry);
    forgedScope.releases[first.release.releaseId].scopeKey = 'public-afl-forged-scope';
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        forgedScope,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const forgedAuthority = structuredClone(registry);
    forgedAuthority.releases[first.release.releaseId].gate5DecisionId =
      `gate-decision:${hash('x')}`;
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        forgedAuthority,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const rehashedInvalidTransition = structuredClone(registry);
    const activationRecordEvent =
      rehashedInvalidTransition.releases[first.release.releaseId].events.at(-1)!;
    activationRecordEvent.from = 'candidate';
    const activationGlobalEvent = rehashedInvalidTransition.events.at(-1)!;
    activationGlobalEvent.content.from = 'candidate';
    const targetState = activationGlobalEvent.content.affectedRecordStates.find(
      ({ releaseId }) => releaseId === first.release.releaseId
    )!;
    targetState.recordState = structuredClone(
      rehashedInvalidTransition.releases[first.release.releaseId]
    );
    targetState.recordStateId = createAflTradeContentAddress(
      'outcome-release-record-state',
      targetState.recordState
    );
    activationGlobalEvent.eventId = createAflTradeContentAddress(
      'outcome-release-event',
      activationGlobalEvent.content
    );
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        rehashedInvalidTransition,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const rehashedHistoricalProjection = structuredClone(registry);
    const validationGlobalEvent = rehashedHistoricalProjection.events[1];
    const validationState = validationGlobalEvent.content.affectedRecordStates[0];
    const projectionContent = validationState.recordState.projectionManifest?.content;
    if (!projectionContent || !('documentCount' in projectionContent)) {
      throw new Error('Fixture validation state must retain a document-backed projection.');
    }
    projectionContent.documentCount += 1;
    validationState.recordStateId = createAflTradeContentAddress(
      'outcome-release-record-state',
      validationState.recordState
    );
    for (let index = 1; index < rehashedHistoricalProjection.events.length; index += 1) {
      const event = rehashedHistoricalProjection.events[index];
      event.content.previousEventId = rehashedHistoricalProjection.events[index - 1].eventId;
      event.eventId = createAflTradeContentAddress('outcome-release-event', event.content);
    }
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        rehashedHistoricalProjection,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));
  });
});

describe('AFL Draft & Trade factual release repository conformance', () => {
  it('admits one concurrent revision winner and leaves the loser unable to overwrite it', async () => {
    const store = new InMemoryAflDraftTradeOutcomeRegistrySnapshotStore();
    const repository = createAflDraftTradeOutcomeReleaseRepository(store);
    const first = fixture('a');
    const second = fixture('b');

    const outcomes = await Promise.allSettled([
      repository.register({
        expectedRevision: 0,
        manifest: first.release,
        actor: 'fixture-importer-a',
        evidenceId: `artifact:${hash('1')}`,
      }),
      repository.register({
        expectedRevision: 0,
        manifest: second.release,
        actor: 'fixture-importer-b',
        evidenceId: `artifact:${hash('2')}`,
      }),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: 'STALE_REVISION' }),
    });
    const committed = await repository.loadRegistry();
    expect(committed.revision).toBe(1);
    expect(committed.events).toHaveLength(1);
    expect(Object.keys(committed.releases)).toHaveLength(1);
  });

  it('round-trips authenticated history without exposing mutable store state', async () => {
    const value = fixture('a');
    let registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    registry = activateFixture(registry, value, 3);
    const repository = createAflDraftTradeOutcomeReleaseRepository(
      new InMemoryAflDraftTradeOutcomeRegistrySnapshotStore(registry)
    );

    const firstRead = await repository.loadRegistry();
    firstRead.events[0].content.actor = 'caller-tampering';
    const secondRead = await repository.loadRegistry();

    expect(secondRead).toEqual(registry);
    await expect(
      repository.captureSelection(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE, selectionEvaluation(value))
    ).resolves.toMatchObject({
      registryRevision: registry.revision,
      selection: { release: { releaseId: value.release.releaseId } },
    });
  });

  it('rejects a store transition that does not advance exactly one revision', async () => {
    const store = new InMemoryAflDraftTradeOutcomeRegistrySnapshotStore();
    await expect(
      store.compareAndSwap({
        expectedRevision: 0,
        nextRegistry: createAflDraftTradeOutcomeReleaseRegistry(),
      })
    ).rejects.toBeInstanceOf(AflDraftTradeOutcomeReleaseRepositoryError);
  });
});

function sqlResult<Row>(
  rows: readonly Row[] = [],
  rowCount: number | null = rows.length
): AflOutcomeSqlQueryResult<Row> {
  return { rows, rowCount };
}

function createStatefulOutcomeSqlClient(initial: AflDraftTradeOutcomeReleaseRegistry) {
  let registry = structuredClone(initial);
  const projections = new Map<
    string,
    { releaseId: string; publicArchiveId: string | null; manifest: unknown }
  >();
  for (const record of Object.values(registry.releases)) {
    if (record.projectionManifest) {
      projections.set(record.projectionManifest.projectionId, {
        releaseId: record.releaseId,
        publicArchiveId:
          record.projectionManifest.content.schemaVersion ===
          'afl-draft-trade-factual-projection/v3'
            ? record.projectionManifest.content.publicArchiveId
            : null,
        manifest: structuredClone(record.projectionManifest),
      });
    }
  }
  const calls: string[] = [];
  let transactionTail = Promise.resolve();

  function createQuery(
    getRegistry: () => AflDraftTradeOutcomeReleaseRegistry,
    setRegistry: (next: AflDraftTradeOutcomeReleaseRegistry) => void,
    projectionStore: Map<
      string,
      { releaseId: string; publicArchiveId: string | null; manifest: unknown }
    >
  ) {
    return async function query<Row>(sql: string, parameters: readonly unknown[] = []) {
      calls.push(sql);
      if (sql.includes('FROM outcome_registry_head')) {
        const current = getRegistry();
        return sqlResult<Row>([
          {
            revision: current.revision,
            last_event_id: current.events.at(-1)?.eventId ?? null,
            registry_json: structuredClone(current),
          } as Row,
        ]);
      }
      if (sql.includes('SELECT release_id FROM outcome_release_manifest')) {
        return sqlResult<Row>([{ release_id: parameters[0] } as Row]);
      }
      if (sql.includes('INSERT INTO outcome_projection_manifest')) {
        const [projectionId, releaseId, publicArchiveId, , manifest] = parameters as [
          string,
          string,
          string | null,
          string,
          unknown,
        ];
        if (!projectionStore.has(projectionId)) {
          projectionStore.set(projectionId, {
            releaseId,
            publicArchiveId,
            manifest: structuredClone(manifest),
          });
        }
        return sqlResult<Row>([], 1);
      }
      if (sql.includes('FROM outcome_projection_manifest')) {
        const [projectionId, releaseId, publicArchiveId, manifest] = parameters as [
          string,
          string,
          string | null,
          unknown,
        ];
        const persisted = projectionStore.get(projectionId);
        const matches =
          persisted?.releaseId === releaseId &&
          persisted.publicArchiveId === publicArchiveId &&
          JSON.stringify(persisted.manifest) === JSON.stringify(manifest);
        return sqlResult<Row>(matches ? ([{ projection_id: projectionId }] as Row[]) : []);
      }
      if (sql.includes('UPDATE outcome_registry_head')) {
        setRegistry(structuredClone(parameters[2] as AflDraftTradeOutcomeReleaseRegistry));
        return sqlResult<Row>([], 1);
      }
      return sqlResult<Row>([], 1);
    };
  }

  const client: AflOutcomeSqlClient = {
    query: createQuery(
      () => registry,
      (next) => {
        registry = next;
      },
      projections
    ),
    async transaction(work) {
      const previousTransaction = transactionTail;
      let releaseTransaction!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      await previousTransaction;
      try {
        let pendingRegistry = structuredClone(registry);
        const pendingProjections = new Map(projections);
        const result = await work({
          query: createQuery(
            () => pendingRegistry,
            (next) => {
              pendingRegistry = next;
            },
            pendingProjections
          ),
        });
        registry = pendingRegistry;
        projections.clear();
        for (const [key, value] of pendingProjections) projections.set(key, value);
        return result;
      } finally {
        releaseTransaction();
      }
    },
  };

  return { client, calls, projections, loadRegistry: () => structuredClone(registry) };
}

function replayRegistryAtRevision(
  source: AflDraftTradeOutcomeReleaseRegistry,
  revision: number
): AflDraftTradeOutcomeReleaseRegistry {
  const releases: Record<string, AflDraftTradeOutcomeReleaseRegistry['releases'][string]> = {};
  const activeByScope: Record<
    string,
    AflDraftTradeOutcomeReleaseRegistry['activeByScope'][string]
  > = {};
  const events = source.events.slice(0, revision);
  for (const event of events) {
    for (const state of event.content.affectedRecordStates) {
      releases[state.releaseId] = structuredClone(state.recordState);
    }
    if (event.content.action === 'activate') {
      activeByScope[event.content.scopeKey] = {
        releaseId: event.content.releaseId,
        activatedAt: event.content.occurredAt,
        revision: event.content.revision,
      };
    } else if (
      event.content.action === 'withdraw' &&
      activeByScope[event.content.scopeKey]?.releaseId === event.content.releaseId
    ) {
      delete activeByScope[event.content.scopeKey];
    }
  }
  return { revision, releases, activeByScope, events };
}

describe('AFL Draft & Trade PostgreSQL release adapter behavior', () => {
  it('returns one stale-revision loser for concurrent repository writers', async () => {
    const database = createStatefulOutcomeSqlClient(createAflDraftTradeOutcomeReleaseRegistry());
    const repository = createPostgresAflDraftTradeOutcomeReleaseRepository(database.client);
    const first = fixture('a');
    const second = fixture('b');

    const outcomes = await Promise.allSettled([
      repository.register({
        expectedRevision: 0,
        manifest: first.release,
        actor: 'fixture-importer-a',
        evidenceId: first.release.releaseId,
      }),
      repository.register({
        expectedRevision: 0,
        manifest: second.release,
        actor: 'fixture-importer-b',
        evidenceId: second.release.releaseId,
      }),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ code: 'STALE_REVISION' }),
    });
    expect(database.loadRegistry().revision).toBe(1);
  });

  it('executes and authenticates register and validate transactions through the injected port', async () => {
    const value = fixture('a');
    const database = createStatefulOutcomeSqlClient(createAflDraftTradeOutcomeReleaseRegistry());
    const repository = createPostgresAflDraftTradeOutcomeReleaseRepository(database.client);

    let registry = await repository.register({
      expectedRevision: 0,
      manifest: value.release,
      actor: 'fixture-importer',
      evidenceId: value.release.releaseId,
    });
    registry = await repository.apply({
      action: 'validate',
      releaseId: value.release.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-06T03:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: value.projection.projectionId,
      environment: 'test_fixture',
      projectionManifest: value.projection,
      gateDecisionLedger: value.rights.ledger,
    });

    expect(database.loadRegistry()).toEqual(registry);
    expect(database.projections.get(value.projection.projectionId)).toEqual({
      releaseId: value.release.releaseId,
      publicArchiveId: null,
      manifest: value.projection,
    });
    expect(database.calls.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(database.calls.some((sql) => sql.includes('ON CONFLICT (projection_id)'))).toBe(true);
  });

  it('persists a fresh superseded-release validation without overwriting its prior projection', async () => {
    const first = fixture('a');
    const second = fixture('b');
    let current = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    current = activateFixture(current, first, 3);
    current = register(current, second.release);
    current = activateFixture(current, second, 6);
    const next = applyAflDraftTradeOutcomeReleaseCommand(current, {
      action: 'validate',
      releaseId: first.release.releaseId,
      expectedRevision: current.revision,
      occurredAt: '2026-08-06T10:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: first.projection.projectionId,
      environment: 'test_fixture',
      projectionManifest: first.projection,
      gateDecisionLedger: first.rights.ledger,
    });
    const database = createStatefulOutcomeSqlClient(current);
    const store = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(database.client);

    await expect(
      store.compareAndSwap({ expectedRevision: current.revision, nextRegistry: next })
    ).resolves.toBe(true);
    expect(database.loadRegistry()).toEqual(next);
    expect(database.projections.size).toBe(2);
  });

  it('persists both record-state commitments and the pointer for an atomic supersession', async () => {
    const first = fixture('a');
    const second = fixture('b');
    let activated = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    activated = activateFixture(activated, first, 3);
    activated = register(activated, second.release);
    activated = activateFixture(activated, second, 6);
    const current = replayRegistryAtRevision(activated, activated.revision - 1);
    const database = createStatefulOutcomeSqlClient(current);
    const store = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(database.client);

    await expect(
      store.compareAndSwap({ expectedRevision: current.revision, nextRegistry: activated })
    ).resolves.toBe(true);

    expect(
      database.calls.filter((sql) => sql.includes('INSERT INTO outcome_record_state_commitment'))
    ).toHaveLength(2);
    expect(database.calls.some((sql) => sql.includes('INSERT INTO outcome_active_release'))).toBe(
      true
    );
    expect(database.loadRegistry()).toEqual(activated);
  });
});
