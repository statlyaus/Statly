import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradePublicationManifestSchema } from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import {
  authenticateAflTradePublicationRegistryPersistence,
  createAflTradePublicationPersistenceEvent,
} from '@/server/aflTradeIntelligence/publication/publicationRegistryPersistence';
import {
  createAflTradePublicationRegistry,
  registerAflTradePublication,
} from '@/server/aflTradeIntelligence/publication/publicationState';

const hash = (value: string) => value.repeat(64);
const artifact = (value: string) => ({
  artifactId: `artifact:${hash(value)}`,
  contentSha256: hash(value),
  storageUri: `artifact://sha256/${hash(value)}`,
  mediaType: 'application/json',
  byteLength: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
});

function publicationManifest() {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current',
    createdAt: '2026-08-08T00:00:00.000Z',
    valuationBundleId: `valuation-bundle:${hash('1')}`,
    gate3DecisionId: `gate-decision:${hash('2')}`,
    sourceRegisterIds: ['fixture-source'],
    supportedViews: ['current' as const],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: [],
    valueUnitId: 'fixture-unit',
    entryCount: 1,
    publicationBundleArtifact: artifact('3'),
    methodologyArtifact: artifact('4'),
    validationReportArtifact: artifact('5'),
    modelCardArtifact: artifact('6'),
  };
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

function registeredFixture() {
  const manifest = publicationManifest();
  const before = createAflTradePublicationRegistry();
  const after = registerAflTradePublication(before, {
    manifest,
    actor: 'fixture-publication-worker',
    evidenceId: artifact('7').artifactId,
  });
  const event = createAflTradePublicationPersistenceEvent({
    previousRegistry: before,
    nextRegistry: after,
    previousEventId: null,
    publicationId: manifest.publicationId,
    action: 'register',
  });
  return { manifest, after, event };
}

describe('AFL trade valuation publication registry persistence', () => {
  it('authenticates an exact immutable event chain and restart snapshot', () => {
    const { manifest, after, event } = registeredFixture();

    const authenticated = authenticateAflTradePublicationRegistryPersistence({
      headRegistry: after,
      publicationManifests: [manifest],
      projectionBindings: [],
      events: [event],
      activePointers: [],
    });

    expect(authenticated).toEqual(after);
    expect(event.content.revision).toBe(1);
    expect(event.content.changedRecords).toEqual([after.publications[manifest.publicationId]]);
  });

  it('rejects a head snapshot that differs from its content-addressed event chain', () => {
    const { manifest, after, event } = registeredFixture();
    const tampered = {
      ...after,
      publications: {
        ...after.publications,
        [manifest.publicationId]: {
          ...after.publications[manifest.publicationId],
          valueUnitId: 'tampered-unit',
        },
      },
    };

    expect(() =>
      authenticateAflTradePublicationRegistryPersistence({
        headRegistry: tampered,
        publicationManifests: [manifest],
        projectionBindings: [],
        events: [event],
        activePointers: [],
      })
    ).toThrow(/event chain/i);
  });

  it('rejects a persistence event whose content-address no longer matches its content', () => {
    const { manifest, after, event } = registeredFixture();
    const tamperedEvent = {
      ...event,
      content: { ...event.content, action: 'approve' as const },
    };

    expect(() =>
      authenticateAflTradePublicationRegistryPersistence({
        headRegistry: after,
        publicationManifests: [manifest],
        projectionBindings: [],
        events: [tamperedEvent],
        activePointers: [],
      })
    ).toThrow(/event/i);
  });
});
