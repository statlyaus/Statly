import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE,
  AFL_TRADE_ARTIFACT_CUSTODY_CLASSES,
  AFL_TRADE_ARTIFACT_CUSTODY_PROFILE_SCHEMA_VERSION,
  AFL_TRADE_ARTIFACT_KEY_DERIVATION,
  aflTradeArtifactCustodyProfileContentSchema,
  aflTradeArtifactCustodyProfileSchema,
  createAflTradeArtifactCustodyProfile,
} from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';

const evidence = (character: string) => `artifact:${character.repeat(64)}`;

function profileContent(
  artifactClass: (typeof AFL_TRADE_ARTIFACT_CUSTODY_CLASSES)[number] = 'raw_source'
) {
  return {
    schemaVersion: AFL_TRADE_ARTIFACT_CUSTODY_PROFILE_SCHEMA_VERSION,
    subject: 'afl-trade-intelligence' as const,
    contractRole: 'requirements_only_not_readiness_or_authorization' as const,
    repositoryId: `fixture-${artifactClass}`,
    environment: 'test_fixture' as const,
    artifactClass,
    maximumObjectBytes: 128 * 1024 * 1024,
    keyDerivation: AFL_TRADE_ARTIFACT_KEY_DERIVATION,
    conditionalCreate: AFL_TRADE_ARTIFACT_CONDITIONAL_CREATE,
    encryption: {
      inTransit: 'tls_required' as const,
      atRest: {
        mode: 'provider_managed' as const,
        keyReferenceSha256: null,
      },
    },
    retention: {
      deletion: {
        kind: 'maximum_age' as const,
        maximumDays: 30,
        enforcement: 'provider_lifecycle_required' as const,
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['AU', 'NZ'],
      crossJurisdictionTransfer: 'approved_jurisdictions_only' as const,
    },
    infrastructureEvidenceIds: [evidence('a'), evidence('b')],
  };
}

describe('AFL trade-intelligence artifact custody profiles', () => {
  it.each(AFL_TRADE_ARTIFACT_CUSTODY_CLASSES)(
    'content-addresses the %s requirements without asserting readiness',
    (artifactClass) => {
      const profile = createAflTradeArtifactCustodyProfile(profileContent(artifactClass));

      expect(profile.profileId).toMatch(/^artifact-custody-profile:[a-f0-9]{64}$/);
      expect(profile.content.artifactClass).toBe(artifactClass);
      expect(profile.content.contractRole).toBe('requirements_only_not_readiness_or_authorization');
      expect(profile.content.conditionalCreate).toBe('if_none_match_star_required');
      expect(JSON.stringify(profile)).not.toMatch(/userId|leagueId|fantasy|firestore|bucket/i);
    }
  );

  it('rejects changed content under an existing profile identifier and unknown fields', () => {
    const profile = createAflTradeArtifactCustodyProfile(profileContent());

    expect(
      aflTradeArtifactCustodyProfileSchema.safeParse({
        ...profile,
        content: { ...profile.content, maximumObjectBytes: 1 },
      }).success
    ).toBe(false);
    expect(
      aflTradeArtifactCustodyProfileContentSchema.safeParse({
        ...profile.content,
        bucket: 'must-not-enter-the-provider-neutral-contract',
      }).success
    ).toBe(false);
  });

  it('requires positive bounded capacity and exact conditional key semantics', () => {
    const content = profileContent();

    for (const invalid of [
      { ...content, maximumObjectBytes: 0 },
      { ...content, maximumObjectBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...content, keyDerivation: 'sha256-flat-v0' },
      { ...content, conditionalCreate: 'best-effort' },
    ]) {
      expect(aflTradeArtifactCustodyProfileContentSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires TLS and a closed provider-managed or customer-managed key contract', () => {
    const content = profileContent();
    const customerManaged = {
      ...content,
      encryption: {
        inTransit: 'tls_required' as const,
        atRest: {
          mode: 'customer_managed' as const,
          keyReferenceSha256: 'c'.repeat(64),
        },
      },
    };

    expect(aflTradeArtifactCustodyProfileContentSchema.safeParse(customerManaged).success).toBe(
      true
    );
    for (const encryption of [
      {
        inTransit: 'plaintext_permitted',
        atRest: { mode: 'provider_managed', keyReferenceSha256: null },
      },
      {
        inTransit: 'tls_required',
        atRest: { mode: 'provider_managed', keyReferenceSha256: 'd'.repeat(64) },
      },
      {
        inTransit: 'tls_required',
        atRest: { mode: 'customer_managed', keyReferenceSha256: null },
      },
    ]) {
      expect(
        aflTradeArtifactCustodyProfileContentSchema.safeParse({ ...content, encryption }).success
      ).toBe(false);
    }
  });

  it('keeps maximum deletion age distinct from optional minimum WORM retention', () => {
    const content = profileContent();
    const validWorm = {
      ...content,
      retention: {
        ...content.retention,
        deleteOnWithdrawal: false,
        worm: { mode: 'compliance' as const, minimumDays: 30 },
      },
    };
    const retainedWithoutSchedule = {
      ...content,
      retention: {
        deletion: {
          kind: 'no_scheduled_deletion' as const,
          maximumDays: null,
          enforcement: 'not_applicable' as const,
        },
        deleteOnWithdrawal: false,
        worm: { mode: 'provider_enforced' as const, minimumDays: 90 },
      },
    };

    expect(aflTradeArtifactCustodyProfileContentSchema.safeParse(validWorm).success).toBe(true);
    expect(
      aflTradeArtifactCustodyProfileContentSchema.safeParse(retainedWithoutSchedule).success
    ).toBe(true);
    expect(
      aflTradeArtifactCustodyProfileContentSchema.safeParse({
        ...content,
        retention: {
          ...content.retention,
          worm: { mode: 'governance', minimumDays: 1 },
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeArtifactCustodyProfileContentSchema.safeParse({
        ...content,
        retention: {
          ...content.retention,
          deleteOnWithdrawal: false,
          worm: { mode: 'compliance', minimumDays: 31 },
        },
      }).success
    ).toBe(false);
  });

  it('requires sorted unique residency and immutable infrastructure evidence', () => {
    const content = profileContent();

    for (const invalid of [
      {
        ...content,
        residency: { ...content.residency, allowedJurisdictions: ['NZ', 'AU'] },
      },
      {
        ...content,
        residency: { ...content.residency, allowedJurisdictions: ['AU', 'AU'] },
      },
      { ...content, infrastructureEvidenceIds: [evidence('b'), evidence('a')] },
      { ...content, infrastructureEvidenceIds: [evidence('a'), evidence('a')] },
      { ...content, infrastructureEvidenceIds: ['https://example.com/mutable-policy'] },
    ]) {
      expect(aflTradeArtifactCustodyProfileContentSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
