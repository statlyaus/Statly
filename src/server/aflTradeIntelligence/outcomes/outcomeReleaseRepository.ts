import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  applyAflDraftTradeOutcomeReleaseCommand,
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  captureAflDraftTradeOutcomeReleaseSelection,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
  type AflDraftTradeOutcomeReleaseCommand,
  type AflDraftTradeOutcomeReleaseRegistry,
} from './outcomeReleaseState';
import type { AflDraftTradeOutcomeAnyReleaseManifest as AflDraftTradeOutcomeReleaseManifest } from './outcomeReleaseContracts';
import type { AflDraftTradeOutcomeSelectionSnapshot } from './outcomeReadService';

export type AflDraftTradeOutcomeReleaseRepositoryErrorCode =
  'STALE_REVISION' | 'PERSISTENCE_UNAVAILABLE' | 'INVALID_PERSISTED_REGISTRY';

export class AflDraftTradeOutcomeReleaseRepositoryError extends Error {
  constructor(
    public readonly code: AflDraftTradeOutcomeReleaseRepositoryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflDraftTradeOutcomeReleaseRepositoryError';
  }
}

export interface AflDraftTradeOutcomeRegistrySnapshotStore {
  load(): Promise<AflDraftTradeOutcomeReleaseRegistry>;
  compareAndSwap(input: {
    expectedRevision: number;
    nextRegistry: AflDraftTradeOutcomeReleaseRegistry;
  }): Promise<boolean>;
}

export interface AflDraftTradeOutcomeReleaseRepository {
  loadRegistry(): Promise<AflDraftTradeOutcomeReleaseRegistry>;
  register(input: {
    expectedRevision: number;
    manifest: AflDraftTradeOutcomeReleaseManifest;
    actor: string;
    evidenceId: string;
    occurredAt?: string;
  }): Promise<AflDraftTradeOutcomeReleaseRegistry>;
  apply(command: AflDraftTradeOutcomeReleaseCommand): Promise<AflDraftTradeOutcomeReleaseRegistry>;
  captureSelection(
    scopeKey: string,
    evaluation: {
      evaluatedAt: string;
      sourceRightsDecisionLedger: AflTradeGateDecisionLedger;
    }
  ): Promise<AflDraftTradeOutcomeSelectionSnapshot>;
}

function cloneRegistry(
  registry: AflDraftTradeOutcomeReleaseRegistry
): AflDraftTradeOutcomeReleaseRegistry {
  return structuredClone(registry);
}

function admitPersistedRegistry(
  value: AflDraftTradeOutcomeReleaseRegistry
): AflDraftTradeOutcomeReleaseRegistry {
  try {
    return authenticateAflDraftTradeOutcomeReleaseRegistry(cloneRegistry(value));
  } catch (error) {
    throw new AflDraftTradeOutcomeReleaseRepositoryError(
      'INVALID_PERSISTED_REGISTRY',
      'The persisted factual-release registry failed authentication.',
      { cause: error }
    );
  }
}

export function createAflDraftTradeOutcomeReleaseRepository(
  store: AflDraftTradeOutcomeRegistrySnapshotStore
): AflDraftTradeOutcomeReleaseRepository {
  async function loadRegistry(): Promise<AflDraftTradeOutcomeReleaseRegistry> {
    try {
      return admitPersistedRegistry(await store.load());
    } catch (error) {
      if (error instanceof AflDraftTradeOutcomeReleaseRepositoryError) throw error;
      throw new AflDraftTradeOutcomeReleaseRepositoryError(
        'PERSISTENCE_UNAVAILABLE',
        'The factual-release registry could not be loaded.',
        { cause: error }
      );
    }
  }

  async function persistTransition(
    expectedRevision: number,
    nextRegistry: AflDraftTradeOutcomeReleaseRegistry
  ): Promise<AflDraftTradeOutcomeReleaseRegistry> {
    let committed: boolean;
    try {
      committed = await store.compareAndSwap({
        expectedRevision,
        nextRegistry: admitPersistedRegistry(nextRegistry),
      });
    } catch (error) {
      throw new AflDraftTradeOutcomeReleaseRepositoryError(
        'PERSISTENCE_UNAVAILABLE',
        'The factual-release registry transition could not be persisted.',
        { cause: error }
      );
    }
    if (!committed) {
      throw new AflDraftTradeOutcomeReleaseRepositoryError(
        'STALE_REVISION',
        `The factual-release registry no longer has revision ${expectedRevision}.`
      );
    }
    return admitPersistedRegistry(nextRegistry);
  }

  return {
    loadRegistry,

    async register(input) {
      const current = await loadRegistry();
      const next = registerAflDraftTradeOutcomeRelease(current, input);
      return persistTransition(input.expectedRevision, next);
    },

    async apply(command) {
      const current = await loadRegistry();
      const next = applyAflDraftTradeOutcomeReleaseCommand(current, command);
      return persistTransition(command.expectedRevision, next);
    },

    async captureSelection(scopeKey, evaluation) {
      return captureAflDraftTradeOutcomeReleaseSelection(
        await loadRegistry(),
        scopeKey,
        evaluation
      );
    },
  };
}

export class InMemoryAflDraftTradeOutcomeRegistrySnapshotStore implements AflDraftTradeOutcomeRegistrySnapshotStore {
  private registry: AflDraftTradeOutcomeReleaseRegistry;

  constructor(initialRegistry = createAflDraftTradeOutcomeReleaseRegistry()) {
    this.registry = admitPersistedRegistry(initialRegistry);
  }

  async load(): Promise<AflDraftTradeOutcomeReleaseRegistry> {
    return cloneRegistry(this.registry);
  }

  async compareAndSwap(input: {
    expectedRevision: number;
    nextRegistry: AflDraftTradeOutcomeReleaseRegistry;
  }): Promise<boolean> {
    if (this.registry.revision !== input.expectedRevision) return false;
    const next = admitPersistedRegistry(input.nextRegistry);
    if (next.revision !== input.expectedRevision + 1) {
      throw new AflDraftTradeOutcomeReleaseRepositoryError(
        'INVALID_PERSISTED_REGISTRY',
        'A registry compare-and-swap must advance exactly one revision.'
      );
    }
    this.registry = cloneRegistry(next);
    return true;
  }
}
