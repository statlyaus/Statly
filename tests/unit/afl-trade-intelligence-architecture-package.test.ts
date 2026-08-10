import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS,
  AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS,
  aflTradeArchitectureDecisionPackageSchema,
  validateAflTradeArchitecturePackageContext,
} from '@/server/aflTradeIntelligence/governance/architectureDecisionPackage';
import {
  AFL_TRADE_AUTHORITY_CONCERNS,
  AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS,
  aflTradeArchitectureCurrentStateSchema,
} from '@/server/aflTradeIntelligence/governance/architectureCurrentState';

const evidenceId = `evidence:${'e'.repeat(64)}`;

function currentStateContent(
  environment: 'test_fixture' | 'non_production' | 'production' = 'test_fixture',
  repositoryRevision = 'a'.repeat(40)
) {
  return {
    schemaVersion: 'afl-trade-architecture-current-state/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment,
    repositoryRevision,
    capturedAt: '2026-08-02T10:00:00.000Z',
    capturedBy: 'fixture-architecture-reviewer',
    captureMethod: 'repository_inspection' as const,
    productionClaim: false as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    verifications: [
      {
        verificationId: 'repository-inspection',
        command: 'Inspect the fixture repository sources without accessing credentials or data.',
        outcome: 'confirmed' as const,
        observedAt: '2026-08-02T10:00:00.000Z',
        evidenceIds: [evidenceId],
      },
    ],
    authorities: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => ({
      concern,
      implementationState: 'not_implemented' as const,
      currentAuthority: `Fixture current authority for ${concern}.`,
      readPath: `Fixture read path for ${concern}.`,
      writePath: `Fixture write path for ${concern}.`,
      sourceReferences: [`fixture/${concern}.ts:1`],
      limitations: [`No production capability is claimed for ${concern}.`],
    })),
    requiredObservations: AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS.map((observation) => ({
      observation,
      finding: `Fabricated finding for ${observation}.`,
      sourceReferences: [`fixture/${observation}.ts:1`],
      verificationIds: ['repository-inspection'],
    })),
    unresolvedQuestions: [
      'Real infrastructure readiness requires independent operational evidence.',
    ],
  };
}

function snapshot(
  environment: 'test_fixture' | 'non_production' | 'production' = 'test_fixture',
  repositoryRevision = 'a'.repeat(40)
) {
  const content = currentStateContent(environment, repositoryRevision);
  return aflTradeArchitectureCurrentStateSchema.parse({
    snapshotId: createAflTradeContentAddress('architecture-current-state', content),
    content,
  });
}

function packageContent(
  currentStateSnapshotId: string,
  environment: 'test_fixture' | 'non_production' | 'production' = 'test_fixture'
) {
  return {
    schemaVersion: 'afl-trade-architecture-decision-package/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment,
    decisionKey: 'fixture-gate1-architecture',
    packageVersion: 1,
    currentStateSnapshotId,
    preparedAt: '2026-08-02T11:00:00.000Z',
    preparedBy: 'fixture-architecture-author',
    packageState: 'proposal_only' as const,
    productionClaim: false as const,
    infrastructureReadiness: 'not_asserted' as const,
    operationalAuthorization: 'not_granted' as const,
    authorityTransfer: 'not_executed' as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    designAssertions: [...AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS],
    isolationContract: {
      protectedFantasyAuthority: 'observed_unchanged_outside_trade_engine' as const,
      analyticalDatabase: {
        deploymentBoundary: 'independent_database_or_isolated_database_and_role' as const,
        credentials: 'separate_pooled_and_direct' as const,
        migrationHistory: 'separate_postgresql_native' as const,
        backupRestore: 'separate_evidence_required' as const,
        connectionBudget: 'separate' as const,
        relationalDependencies: 'no_fantasy_foreign_keys' as const,
      },
      publicIdentities: 'source_native_no_fantasy_ownership' as const,
      valuationProjectionPointer: 'separate_from_legacy_archive_pointer' as const,
    },
    authorityMatrix: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => {
      const currentAuthority = `Fixture current authority for ${concern}.`;
      const protectedFantasy = concern === 'protected_fantasy_relational_state';
      return {
        concern,
        currentAuthority,
        targetAuthority: protectedFantasy
          ? currentAuthority
          : `Fixture proposed target for ${concern}.`,
        transitionRequired: !protectedFantasy,
        currentAuthorityDisposition: 'unchanged_until_authorized_activation' as const,
        targetAuthorityStatus: 'proposed_not_authoritative' as const,
        activationOwner: 'fixture-operations-owner',
        activationConditions: [`Verify the fabricated ${concern} target.`],
        retirementConditions: [`Close the fabricated ${concern} rollback window.`],
      };
    }),
    sections: AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS.map((section) => ({
      section,
      decision: `Fabricated design decision for ${section}.`,
      owner: 'fixture-architecture-owner',
      acceptanceCriteria: [`Review the fabricated ${section} decision.`],
      evidenceIds: [evidenceId],
      sourceReferences: [`fixture/${section}.md:1`],
    })),
    readinessEvidenceRequirements: ['Observe target behavior in a controlled environment.'],
    operationalAuthorizationRequirements: [
      'Record a separate authorized operation after readiness is demonstrated.',
    ],
    limitations: ['This fixture package grants no production authority.'],
  };
}

function decisionPackage(
  sourceSnapshot = snapshot(),
  environment: 'test_fixture' | 'non_production' | 'production' = sourceSnapshot.content.environment
) {
  const content = packageContent(sourceSnapshot.snapshotId, environment);
  return aflTradeArchitectureDecisionPackageSchema.parse({
    packageId: createAflTradeContentAddress('architecture-decision-package', content),
    content,
  });
}

describe('AFL trade-intelligence Gate 1 architecture package', () => {
  it('accepts a complete content-addressed snapshot and proposal-only package', () => {
    const sourceSnapshot = snapshot();
    const architecturePackage = decisionPackage(sourceSnapshot);

    expect(validateAflTradeArchitecturePackageContext(sourceSnapshot, architecturePackage)).toEqual(
      { valid: true, issues: [] }
    );
  });

  it('rejects changed snapshot content under an existing content address', () => {
    const valid = snapshot();
    const changed = {
      ...valid,
      content: { ...valid.content, capturedBy: 'different-reviewer' },
    };

    expect(aflTradeArchitectureCurrentStateSchema.safeParse(changed).success).toBe(false);
  });

  it('requires every current-state risk and authority concern exactly once', () => {
    expect(AFL_TRADE_AUTHORITY_CONCERNS.length).toBeGreaterThanOrEqual(2);
    const content = currentStateContent();
    const missingObservation = {
      ...content,
      requiredObservations: content.requiredObservations.slice(1),
    };
    const duplicateAuthority = {
      ...content,
      authorities: content.authorities.map((authority, index) =>
        index === 1 ? { ...authority, concern: content.authorities[0].concern } : authority
      ),
    };

    expect(
      aflTradeArchitectureCurrentStateSchema.safeParse({
        snapshotId: createAflTradeContentAddress('architecture-current-state', missingObservation),
        content: missingObservation,
      }).success
    ).toBe(false);
    expect(
      aflTradeArchitectureCurrentStateSchema.safeParse({
        snapshotId: createAflTradeContentAddress('architecture-current-state', duplicateAuthority),
        content: duplicateAuthority,
      }).success
    ).toBe(false);
  });

  it('rejects observations that cite unknown repository verifications', () => {
    const content = currentStateContent();
    const invalid = {
      ...content,
      requiredObservations: content.requiredObservations.map((observation, index) =>
        index === 0 ? { ...observation, verificationIds: ['missing-verification'] } : observation
      ),
    };

    expect(
      aflTradeArchitectureCurrentStateSchema.safeParse({
        snapshotId: createAflTradeContentAddress('architecture-current-state', invalid),
        content: invalid,
      }).success
    ).toBe(false);
  });

  it('requires every decision section, design assertion, and authority concern exactly once', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);
    const invalid = { ...content, sections: content.sections.slice(1) };

    expect(
      aflTradeArchitectureDecisionPackageSchema.safeParse({
        packageId: createAflTradeContentAddress('architecture-decision-package', invalid),
        content: invalid,
      }).success
    ).toBe(false);
    for (const changed of [
      { ...content, designAssertions: content.designAssertions.slice(1) },
      { ...content, authorityMatrix: content.authorityMatrix.slice(1) },
    ]) {
      expect(
        aflTradeArchitectureDecisionPackageSchema.safeParse({
          packageId: createAflTradeContentAddress('architecture-decision-package', changed),
          content: changed,
        }).success
      ).toBe(false);
    }
  });

  it('rejects contradictory transition declarations', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);
    const invalid = {
      ...content,
      authorityMatrix: content.authorityMatrix.map((entry) =>
        entry.concern === 'analytical_records'
          ? { ...entry, targetAuthority: entry.currentAuthority }
          : entry
      ),
    };

    expect(
      aflTradeArchitectureDecisionPackageSchema.safeParse({
        packageId: createAflTradeContentAddress('architecture-decision-package', invalid),
        content: invalid,
      }).success
    ).toBe(false);
  });

  it('rejects any attempt to transfer protected fantasy relational authority', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);
    const invalid = {
      ...content,
      authorityMatrix: content.authorityMatrix.map((entry) =>
        entry.concern === 'protected_fantasy_relational_state'
          ? {
              ...entry,
              targetAuthority: 'A trade-engine-owned fantasy database.',
              transitionRequired: true,
            }
          : entry
      ),
    };

    expect(
      aflTradeArchitectureDecisionPackageSchema.safeParse({
        packageId: createAflTradeContentAddress('architecture-decision-package', invalid),
        content: invalid,
      }).success
    ).toBe(false);
  });

  it('requires the exact analytical isolation contract', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);
    const { isolationContract: _omitted, ...missingIsolationContract } = content;
    const sharedProjectionPointer = {
      ...content,
      isolationContract: {
        ...content.isolationContract,
        valuationProjectionPointer: 'shared_with_legacy_archive_pointer',
      },
    };

    for (const changed of [missingIsolationContract, sharedProjectionPointer]) {
      expect(
        aflTradeArchitectureDecisionPackageSchema.safeParse({
          packageId: createAflTradeContentAddress('architecture-decision-package', changed),
          content: changed,
        }).success
      ).toBe(false);
    }
  });

  it('cannot encode readiness, operational permission, cutover, or a production claim', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);

    for (const changed of [
      { ...content, infrastructureReadiness: 'ready' },
      { ...content, operationalAuthorization: 'granted' },
      { ...content, authorityTransfer: 'executed' },
      { ...content, productionClaim: true },
    ]) {
      expect(
        aflTradeArchitectureDecisionPackageSchema.safeParse({
          packageId: createAflTradeContentAddress('architecture-decision-package', changed),
          content: changed,
        }).success
      ).toBe(false);
    }
  });

  it('fails contextual validation for a different snapshot or environment', () => {
    const sourceSnapshot = snapshot();
    const otherSnapshot = snapshot('test_fixture', 'b'.repeat(40));
    const wrongSnapshotPackage = decisionPackage(otherSnapshot);
    const wrongEnvironmentPackage = decisionPackage(sourceSnapshot, 'non_production');

    expect(
      validateAflTradeArchitecturePackageContext(sourceSnapshot, wrongSnapshotPackage).issues
    ).toContainEqual(expect.objectContaining({ code: 'current_state_reference_mismatch' }));
    expect(
      validateAflTradeArchitecturePackageContext(sourceSnapshot, wrongEnvironmentPackage).issues
    ).toContainEqual(expect.objectContaining({ code: 'environment_mismatch' }));
  });

  it('requires every package current authority to match the referenced snapshot', () => {
    const sourceSnapshot = snapshot();
    const content = packageContent(sourceSnapshot.snapshotId);
    content.authorityMatrix = content.authorityMatrix.map((entry) =>
      entry.concern === 'analytical_records'
        ? { ...entry, currentAuthority: 'A contradictory current authority.' }
        : entry
    );
    const changedPackage = aflTradeArchitectureDecisionPackageSchema.parse({
      packageId: createAflTradeContentAddress('architecture-decision-package', content),
      content,
    });

    expect(
      validateAflTradeArchitecturePackageContext(sourceSnapshot, changedPackage).issues
    ).toContainEqual(expect.objectContaining({ code: 'current_authority_mismatch' }));
  });
});
