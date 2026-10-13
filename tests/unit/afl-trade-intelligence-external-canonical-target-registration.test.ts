import { expect, it } from 'vitest';
import { createAflTradeContentAddress as address } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeExternalIdentitySubject,
  createAflTradeExternalIdentityReviewWorkItem,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import { aflTradeExternalCanonicalTargetRegistrationSchema } from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
const at = '2026-09-10T00:00:00.000Z';
const id = (prefix: string, letter: string) => `${prefix}:${letter.repeat(64)}`;
function fixture() {
  const subject = createAflTradeExternalIdentitySubject({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider: 'draftguru',
    entityKind: 'player',
    identityScope: { kind: 'provider_native_id', nativeId: 'synthetic-player' },
  });
  const workItem = createAflTradeExternalIdentityReviewWorkItem({
    subject,
    observations: [
      {
        evidenceId: id('external-evidence', 'a'),
        batchId: id('external-evidence-batch', 'b'),
        sourceIdentity: { nativeId: 'synthetic-player', recordedName: 'Synthetic Player' },
        seasonYear: 2024,
        capturedAt: at,
      },
    ],
  });
  const targetSnapshot = {
    evidenceKind: 'canonical_target_snapshot',
    schemaVersion: 'afl-trade-canonical-target-snapshot/v2',
    environment: 'test_fixture',
    source: { historicalCompletionId: id('external-historical-capture-completion', 'c'), workItem },
    record: {
      entityKind: 'player',
      canonicalId: 'player:synthetic-absent',
      displayName: 'Synthetic Player',
      birthDate: null,
    },
  };
  const content = {
    schemaVersion: 'afl-trade-canonical-target-registration/v2',
    authorityBoundary: 'reviewed_canonical_creation_no_provider_assignment',
    action: 'create',
    targetSnapshot,
    targetSnapshotReferenceId: address('canonical-target-snapshot', targetSnapshot),
    reviewerAuthority: {
      principalRef: 'synthetic-reviewer',
      authorityEvidence: { id: id('reviewer-authority-evidence', 'd'), sha256: 'd'.repeat(64) },
    },
    supportingEvidence: [
      createAflTradeCanonicalJsonArtifactRef(
        {
          syntheticIdentityReview:
            'Source native identity reviewed against existing canonical records; no candidate match.',
        },
        at
      ),
    ],
    rationale: 'Synthetic absent person explicitly reviewed.',
    decidedAt: at,
  };
  return { registrationDecisionId: address('canonical-target-registration', content), content };
}
it('binds reviewed external native identity and explicit create/reuse without fictional normalization', () => {
  const registration = fixture();
  const parsed = aflTradeExternalCanonicalTargetRegistrationSchema.parse(registration);
  expect(parsed.content.targetSnapshot.record).toMatchObject({
    entityKind: 'player',
    birthDate: null,
  });
  expect(parsed.content.targetSnapshot).not.toHaveProperty('staging');
  expect(parsed.content).not.toHaveProperty('resolutionDecision');
  const changed = (change: Record<string, unknown>) => {
    const content = { ...registration.content, ...change };
    return { registrationDecisionId: address('canonical-target-registration', content), content };
  };
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(changed({ action: undefined }))
  ).toThrow();
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(changed({ supportingEvidence: [] }))
  ).toThrow();
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(
      changed({ targetSnapshotReferenceId: id('canonical-target-snapshot', 'e') })
    )
  ).toThrow();
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(
      changed({ decidedAt: '2026-09-09T00:00:00.000Z' })
    )
  ).toThrow();
  const unknownNameSubject = createAflTradeExternalIdentitySubject({
    ...registration.content.targetSnapshot.source.workItem.content.subject.content,
    identityScope: {
      kind: 'exact_recorded_name',
      recordedName: 'Synthetic Player',
      seasonYear: 2024,
    },
  });
  const nameWork = createAflTradeExternalIdentityReviewWorkItem({
    subject: unknownNameSubject,
    observations: [
      {
        ...registration.content.targetSnapshot.source.workItem.content.observations[0]!,
        sourceIdentity: { nativeId: null, recordedName: 'Synthetic Player' },
      },
    ],
  });
  const nameSnapshot = {
    ...registration.content.targetSnapshot,
    source: { ...registration.content.targetSnapshot.source, workItem: nameWork },
  };
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(
      changed({
        targetSnapshot: nameSnapshot,
        targetSnapshotReferenceId: address('canonical-target-snapshot', nameSnapshot),
      })
    )
  ).toThrow();
  const nonnullBio = {
    ...registration.content.targetSnapshot,
    record: { ...registration.content.targetSnapshot.record, birthDate: '2006-01-01' },
  };
  expect(() =>
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(
      changed({
        targetSnapshot: nonnullBio,
        targetSnapshotReferenceId: address('canonical-target-snapshot', nonnullBio),
      })
    )
  ).toThrow();
  expect(
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(changed({ action: 'reuse' })).content
      .action
  ).toBe('reuse');
});
it('lets a player creation review name same-name players it found distinct, and nothing else', () => {
  const registration = fixture();
  const changed = (change: Record<string, unknown>) => {
    const content = { ...registration.content, ...change };
    return { registrationDecisionId: address('canonical-target-registration', content), content };
  };
  const parses = (change: Record<string, unknown>) =>
    aflTradeExternalCanonicalTargetRegistrationSchema.safeParse(changed(change)).success;
  expect(
    aflTradeExternalCanonicalTargetRegistrationSchema.parse(
      changed({ distinctFromPlayerIds: ['player:afl-tables-a', 'player:afl-tables-b'] })
    ).content.distinctFromPlayerIds
  ).toEqual(['player:afl-tables-a', 'player:afl-tables-b']);
  expect(parses({ distinctFromPlayerIds: [] })).toBe(false);
  expect(parses({ distinctFromPlayerIds: null })).toBe(false);
  expect(parses({ distinctFromPlayerIds: ['player:b', 'player:a'] })).toBe(false);
  expect(parses({ distinctFromPlayerIds: ['player:a', 'player:a'] })).toBe(false);
  expect(parses({ distinctFromPlayerIds: ['player:synthetic-absent'] })).toBe(false);
  expect(parses({ action: 'reuse', distinctFromPlayerIds: ['player:a'] })).toBe(false);
  const content = registration.content.targetSnapshot.source.workItem.content;
  const club = {
    ...registration.content.targetSnapshot,
    source: {
      ...registration.content.targetSnapshot.source,
      workItem: createAflTradeExternalIdentityReviewWorkItem({
        subject: createAflTradeExternalIdentitySubject({
          ...content.subject.content,
          entityKind: 'club',
        }),
        observations: content.observations,
      }),
    },
    record: {
      entityKind: 'club',
      canonicalId: 'club:synthetic',
      currentName: 'Synthetic Club',
      abbreviation: null,
      activeFromYear: null,
      activeThroughYear: null,
    },
  };
  const clubChange = {
    targetSnapshot: club,
    targetSnapshotReferenceId: address('canonical-target-snapshot', club),
  };
  expect(parses(clubChange)).toBe(true);
  expect(parses({ ...clubChange, distinctFromPlayerIds: ['player:a'] })).toBe(false);
});
