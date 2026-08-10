import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_AUTHORITY_CONCERNS } from '@/server/aflTradeIntelligence/governance/architectureCurrentState';
import {
  AflTradeAuthorityTransitionError,
  appendAflTradeAuthorityTransition,
  createAflTradeAuthorityTransitionLedger,
  validateAflTradeAuthorityTransitionLedger,
  type AflTradeAuthorityTransitionCommand,
  type AflTradeAuthorityTransitionLedger,
  type AflTradeAuthorityTransitionState,
} from '@/server/aflTradeIntelligence/governance/authorityTransition';

const ids = {
  snapshot: `architecture-current-state:${'a'.repeat(64)}`,
  architecturePackage: `architecture-decision-package:${'b'.repeat(64)}`,
  gate1Decision: `gate-decision:${'c'.repeat(64)}`,
  readiness: `evidence:${'d'.repeat(64)}`,
  operationDecision: `operation-decision:${'e'.repeat(64)}`,
  operationEvidence: `evidence:${'f'.repeat(64)}`,
  operatorEvidence: `evidence:${'1'.repeat(64)}`,
  parityEvidence: `evidence:${'2'.repeat(64)}`,
  barrierEvidence: `evidence:${'3'.repeat(64)}`,
};

function ledger(
  environment: AflTradeAuthorityTransitionLedger['environment'] = 'test_fixture'
): AflTradeAuthorityTransitionLedger {
  return createAflTradeAuthorityTransitionLedger({
    environment,
    currentStateSnapshotId: ids.snapshot,
    initialAuthorities: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => ({
      concern,
      authority: `current-${concern}`,
      authorityEpoch: 1 as const,
    })),
  });
}

function command(
  sourceLedger: AflTradeAuthorityTransitionLedger,
  state: AflTradeAuthorityTransitionState,
  options: Partial<AflTradeAuthorityTransitionCommand> = {}
): AflTradeAuthorityTransitionCommand {
  const occurredAtByState = {
    prepared: '2026-08-02T10:00:00.000Z',
    activated: '2026-08-02T11:00:00.000Z',
    rolled_back: '2026-08-02T12:00:00.000Z',
    retired: '2026-08-04T10:00:00.000Z',
  } as const;
  return {
    expectedRevision: sourceLedger.revision,
    transitionKey: 'fixture-analytical-records-cutover',
    concern: 'analytical_records',
    state,
    fromAuthority: 'current-analytical_records',
    toAuthority: 'proposed-analytical-records',
    architecturePackageId: ids.architecturePackage,
    gate1DecisionId: ids.gate1Decision,
    verificationMode: 'fixture',
    readinessEvidenceIds: [ids.readiness],
    operationalAuthorization: {
      decisionId: ids.operationDecision,
      evidenceId: ids.operationEvidence,
      authorizedOperation: 'transfer_authority',
      expiresAt: '2026-08-05T00:00:00.000Z',
    },
    operatorAuthorization: {
      operatorId: 'fixture-operator',
      role: 'fixture-operations-owner',
      evidenceId: ids.operatorEvidence,
    },
    parityCheckpoint: {
      status: 'passed',
      comparedAt: '2026-08-02T09:00:00.000Z',
      evidenceIds: [ids.parityEvidence],
    },
    writeBarrier: {
      state: state === 'prepared' ? 'planned' : 'engaged',
      evidenceId: ids.barrierEvidence,
    },
    rollbackWindowEndsAt: '2026-08-03T00:00:00.000Z',
    occurredAt: occurredAtByState[state],
    reason: `Fabricated ${state} event for deterministic tests.`,
    ...options,
  };
}

function prepare(sourceLedger = ledger()) {
  return appendAflTradeAuthorityTransition(sourceLedger, command(sourceLedger, 'prepared'));
}

function activate(sourceLedger = prepare()) {
  return appendAflTradeAuthorityTransition(sourceLedger, command(sourceLedger, 'activated'));
}

describe('AFL trade-intelligence authority transition ledger', () => {
  it('requires exactly one initial authority for every concern', () => {
    expect(() =>
      createAflTradeAuthorityTransitionLedger({
        environment: 'test_fixture',
        currentStateSnapshotId: ids.snapshot,
        initialAuthorities: [
          {
            concern: 'analytical_records',
            authority: 'only-one-authority',
            authorityEpoch: 1,
          },
        ],
      })
    ).toThrow(AflTradeAuthorityTransitionError);
  });

  it('rejects commands that target protected fantasy relational authority', () => {
    const sourceLedger = ledger();

    expect(() =>
      appendAflTradeAuthorityTransition(
        sourceLedger,
        command(sourceLedger, 'prepared', {
          concern: 'protected_fantasy_relational_state',
          fromAuthority: 'current-protected_fantasy_relational_state',
          toAuthority: 'proposed-trade-engine-owned-fantasy-state',
        })
      )
    ).toThrow(expect.objectContaining({ code: 'PROTECTED_AUTHORITY_BOUNDARY' }));
    expect(sourceLedger.revision).toBe(0);
    expect(sourceLedger.events).toHaveLength(0);
  });

  it('keeps the old authority current while a transition is only prepared', () => {
    const prepared = prepare();
    const validation = validateAflTradeAuthorityTransitionLedger(prepared);

    expect(validation.valid).toBe(true);
    expect(validation.currentAuthorities?.analytical_records).toMatchObject({
      authority: 'current-analytical_records',
      authorityEpoch: 1,
      establishedByEventId: null,
    });
  });

  it('changes authority only on an authorized CAS activation', () => {
    const activated = activate();
    const validation = validateAflTradeAuthorityTransitionLedger(activated);

    expect(validation.valid).toBe(true);
    expect(activated.revision).toBe(2);
    expect(validation.currentAuthorities?.analytical_records).toMatchObject({
      authority: 'proposed-analytical-records',
      authorityEpoch: 2,
      establishedByEventId: activated.events[1].eventId,
    });
    expect(Object.keys(validation.currentAuthorities ?? {})).toHaveLength(
      AFL_TRADE_AUTHORITY_CONCERNS.length
    );
  });

  it('rejects a stale expected revision', () => {
    const prepared = prepare();

    expect(() =>
      appendAflTradeAuthorityTransition(
        prepared,
        command(prepared, 'activated', { expectedRevision: 0 })
      )
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
  });

  it('rejects activation without preparation and a second active transition for one concern', () => {
    const sourceLedger = ledger();
    expect(() =>
      appendAflTradeAuthorityTransition(sourceLedger, command(sourceLedger, 'activated'))
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));

    const prepared = prepare(sourceLedger);
    expect(() =>
      appendAflTradeAuthorityTransition(
        prepared,
        command(prepared, 'prepared', { transitionKey: 'second-transition' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('does not allow the verification basis to change within a transition', () => {
    const prepared = prepare();
    expect(() =>
      appendAflTradeAuthorityTransition(
        prepared,
        command(prepared, 'activated', { verificationMode: 'trusted_external_registry' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('keeps transition keys unique across authority concerns', () => {
    const prepared = prepare();

    expect(() =>
      appendAflTradeAuthorityTransition(
        prepared,
        command(prepared, 'prepared', {
          concern: 'immutable_artifacts',
          fromAuthority: 'current-immutable_artifacts',
          toAuthority: 'proposed-immutable-artifacts',
        })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('restores the old authority during the rollback window and advances the epoch', () => {
    const activated = activate();
    const rolledBack = appendAflTradeAuthorityTransition(
      activated,
      command(activated, 'rolled_back')
    );
    const validation = validateAflTradeAuthorityTransitionLedger(rolledBack);

    expect(validation.valid).toBe(true);
    expect(validation.currentAuthorities?.analytical_records).toMatchObject({
      authority: 'current-analytical_records',
      authorityEpoch: 3,
      establishedByEventId: rolledBack.events[2].eventId,
    });
  });

  it('rejects rollback after the window and retirement before it closes', () => {
    const activated = activate();

    expect(() =>
      appendAflTradeAuthorityTransition(
        activated,
        command(activated, 'rolled_back', { occurredAt: '2026-08-04T00:00:00.000Z' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(() =>
      appendAflTradeAuthorityTransition(
        activated,
        command(activated, 'rolled_back', { occurredAt: '2026-08-03T00:00:00.000Z' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(() =>
      appendAflTradeAuthorityTransition(
        activated,
        command(activated, 'retired', { occurredAt: '2026-08-02T12:00:00.000Z' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('retires the old authority only after the rollback window while keeping the target current', () => {
    const activated = activate();
    const retired = appendAflTradeAuthorityTransition(activated, command(activated, 'retired'));
    const validation = validateAflTradeAuthorityTransitionLedger(retired);

    expect(validation.valid).toBe(true);
    expect(validation.currentAuthorities?.analytical_records).toMatchObject({
      authority: 'proposed-analytical-records',
      authorityEpoch: 2,
    });
  });

  it('closes an unactivated preparation without engaging the barrier or changing authority', () => {
    const prepared = prepare();
    const retired = appendAflTradeAuthorityTransition(
      prepared,
      command(prepared, 'retired', {
        occurredAt: '2026-08-02T11:00:00.000Z',
        writeBarrier: { state: 'planned', evidenceId: ids.barrierEvidence },
      })
    );
    const validation = validateAflTradeAuthorityTransitionLedger(retired);

    expect(validation.valid).toBe(true);
    expect(validation.currentAuthorities?.analytical_records).toMatchObject({
      authority: 'current-analytical_records',
      authorityEpoch: 1,
      establishedByEventId: null,
    });
  });

  it('does not resolve non-fixture authority without a trusted evidence verifier', () => {
    expect(() => ledger('production')).toThrow(
      expect.objectContaining({
        code: 'INVALID_LEDGER',
        message: expect.stringContaining('trusted evidence verifier'),
      })
    );
  });

  it('rejects event tampering and broken append-only chains', () => {
    const activated = activate();
    const secondEvent = activated.events[1];
    const changedContent = { ...secondEvent.content, previousEventId: null };
    const changedEvent = {
      eventId: createAflTradeContentAddress('authority-transition', changedContent),
      content: changedContent,
    };
    const invalidLedger = { ...activated, events: [activated.events[0], changedEvent] };
    const validation = validateAflTradeAuthorityTransitionLedger(invalidLedger);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'event_chain_mismatch' })
    );
    expect(validation.currentAuthorities).toBeNull();
  });

  it('rejects replayed events that target protected fantasy relational authority', () => {
    const prepared = prepare();
    const changedContent = {
      ...prepared.events[0].content,
      concern: 'protected_fantasy_relational_state' as const,
    };
    const changedEvent = {
      eventId: createAflTradeContentAddress('authority-transition', changedContent),
      content: changedContent,
    };
    const invalidLedger = { ...prepared, events: [changedEvent] };
    const validation = validateAflTradeAuthorityTransitionLedger(invalidLedger);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'invalid_event' }));
    expect(validation.currentAuthorities).toBeNull();
  });

  it('returns structured failures for malformed events and commands', () => {
    const malformedLedger = {
      ...ledger(),
      revision: 1,
      events: [null],
    } as unknown as AflTradeAuthorityTransitionLedger;
    expect(validateAflTradeAuthorityTransitionLedger(malformedLedger).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_event', eventId: null })
    );
    const sourceLedger = ledger();
    expect(() =>
      appendAflTradeAuthorityTransition(
        sourceLedger,
        command(sourceLedger, 'prepared', { occurredAt: 'not-an-instant' })
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('reports malformed ledger and event-chain failures in stable order', () => {
    const activated = activate();
    const malformedLedger = {
      ...activated,
      schemaVersion: 'invalid-ledger-version',
      environment: 'production',
      currentStateSnapshotId: 'invalid-snapshot',
      revision: 3,
      events: [null, activated.events[1]],
    } as unknown as AflTradeAuthorityTransitionLedger;

    expect(validateAflTradeAuthorityTransitionLedger(malformedLedger)).toEqual({
      valid: false,
      issues: [
        {
          code: 'invalid_ledger_header',
          eventId: null,
          message: 'The authority ledger header is invalid.',
        },
        {
          code: 'trusted_evidence_verification_required',
          eventId: null,
          message:
            'Non-fixture authority resolution requires a trusted evidence verifier that is not implemented.',
        },
        {
          code: 'revision_mismatch',
          eventId: null,
          message: 'The registry revision must equal the append-only event count.',
        },
        {
          code: 'invalid_event',
          eventId: null,
          message: 'Event at revision 1 is invalid.',
        },
        {
          code: 'event_chain_mismatch',
          eventId: activated.events[1].eventId,
          message: 'The event does not extend the latest global ledger event.',
        },
        {
          code: 'concern_chain_mismatch',
          eventId: activated.events[1].eventId,
          message: 'The event does not extend the latest event for its authority concern.',
        },
        {
          code: 'environment_mismatch',
          eventId: activated.events[1].eventId,
          message: 'Authority event and ledger environments must match.',
        },
        {
          code: 'transition_identity_mismatch',
          eventId: activated.events[1].eventId,
          message: 'The event must continue the active transition identity.',
        },
      ],
      currentAuthorities: null,
    });
  });
});
