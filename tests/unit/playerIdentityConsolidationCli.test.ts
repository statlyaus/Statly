import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPlayerIdentitySourceFingerprint,
  createPlayerIdentitySourceFingerprint,
  parsePlayerIdentityCliArgs,
  validateDisposablePlayerIdentityDatabase,
  validateProductionPlayerIdentityDatabase,
  validatePlayerIdentityFirestoreProject,
  validateReviewedPlayerIdentityManifest,
} from '../../src/server/players/playerIdentityConsolidationCli';

const createdPaths: string[] = [];

afterEach(() => {
  for (const filePath of createdPaths.splice(0)) {
    try {
      unlinkSync(filePath);
    } catch {
      // The test may deliberately fail before creating every path.
    }
  }
});

describe('player identity consolidation CLI safety', () => {
  it('requires an explicit mode and a manifest path value', () => {
    expect(() => parsePlayerIdentityCliArgs([])).toThrow('Use --propose');
    expect(() => parsePlayerIdentityCliArgs(['--manifest', '--apply'])).toThrow(
      '--manifest requires a file path'
    );
    expect(() => parsePlayerIdentityCliArgs(['--propose', '--project-waivers'])).toThrow(
      '--propose cannot be combined'
    );
    expect(parsePlayerIdentityCliArgs(['--manifest', 'manifest.json', '--apply'])).toEqual({
      apply: true,
      projectWaivers: false,
      propose: false,
      production: false,
      manifestPath: 'manifest.json',
    });
    expect(parsePlayerIdentityCliArgs(['--production', '--project-waivers'])).toEqual({
      apply: false,
      projectWaivers: true,
      propose: false,
      production: true,
    });
  });

  it('rejects truthy non-boolean review flags and malformed mappings', () => {
    expect(() =>
      validateReviewedPlayerIdentityManifest({
        schemaVersion: 1,
        reviewed: 'false',
        mappings: [],
      })
    ).toThrow('reviewed must be a boolean');
    expect(() =>
      validateReviewedPlayerIdentityManifest({
        schemaVersion: 1,
        reviewed: false,
        sourceFingerprint: 'a'.repeat(64),
        mappings: [{ aliasId: 'same', canonicalPlayerId: 'same' }],
      })
    ).toThrow('cannot map a player to itself');
  });

  it('binds reviewed manifests to a stable player data fingerprint', () => {
    const players = [
      { id: 'b', name: 'Second', club: 'BBB', position: null },
      { id: 'a', name: 'First', club: 'AAA', position: 'MID' },
    ];

    expect(createPlayerIdentitySourceFingerprint(players)).toBe(
      createPlayerIdentitySourceFingerprint([...players].reverse())
    );
    expect(() => assertPlayerIdentitySourceFingerprint('0'.repeat(64), players)).toThrow(
      'generate and review a new manifest'
    );
    expect(
      validateReviewedPlayerIdentityManifest({
        schemaVersion: 1,
        reviewed: true,
        reviewedBy: 'operator@example.test',
        reviewedAt: '2026-07-24T20:00:00.000Z',
        sourceFingerprint: createPlayerIdentitySourceFingerprint(players),
        mappings: [{ aliasId: 'b', canonicalPlayerId: 'a' }],
      })
    ).toMatchObject({ reviewed: true, reviewedBy: 'operator@example.test' });
  });

  const verifyUrl = 'postgresql://statly:pw@127.0.0.1:55440/statly_verify_player_run1';
  const productionUrl = 'postgresql://statly:pw@db.internal:5432/statly_fantasy';

  it('accepts only a matching statly_verify_player_* PostgreSQL database', () => {
    expect(
      validateDisposablePlayerIdentityDatabase({ databaseUrl: verifyUrl, expectedUrl: verifyUrl })
    ).toBe(verifyUrl);
    expect(() =>
      validateDisposablePlayerIdentityDatabase({
        databaseUrl: 'file:/tmp/statly-verify-player-1.db',
        expectedUrl: verifyUrl,
      })
    ).toThrow('postgresql://');
    expect(() =>
      validateDisposablePlayerIdentityDatabase({
        databaseUrl: verifyUrl,
        expectedUrl: verifyUrl.replace('run1', 'run2'),
      })
    ).toThrow('exactly match STATLY_VERIFY_DB');
  });

  it('rejects a disposable run aimed at the development database', () => {
    const devUrl = 'postgresql://statly:pw@127.0.0.1:55440/statly_fantasy_dev';
    expect(() =>
      validateDisposablePlayerIdentityDatabase({ databaseUrl: devUrl, expectedUrl: devUrl })
    ).toThrow('statly_verify_player_*');
  });

  it('requires an explicitly matched production database and a backup for apply', () => {
    const backupPath = join(tmpdir(), `statly-production-player-${process.pid}.dump`);
    createdPaths.push(backupPath);
    writeFileSync(backupPath, 'pg_dump fixture');

    expect(
      validateProductionPlayerIdentityDatabase({
        databaseUrl: productionUrl,
        expectedUrl: productionUrl,
        backupPath,
        requireBackup: true,
      })
    ).toBe(productionUrl);
    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: productionUrl,
        expectedUrl: productionUrl,
        requireBackup: true,
      })
    ).toThrow('BACKUP');
    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: productionUrl,
        expectedUrl: productionUrl.replace('db.internal', 'other.internal'),
        requireBackup: false,
      })
    ).toThrow('exactly match STATLY_PLAYER_IDENTITY_PRODUCTION_DB');
    const testUrl = 'postgresql://statly:pw@127.0.0.1:55440/statly_fantasy_test';
    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: testUrl,
        expectedUrl: testUrl,
        requireBackup: false,
      })
    ).toThrow('development or test database');
  });

  it('rejects empty or stale backups and mismatched Firestore projects', () => {
    const emptyPath = join(tmpdir(), `statly-production-player-${process.pid}-empty.dump`);
    const stalePath = join(tmpdir(), `statly-production-player-${process.pid}-stale.dump`);
    createdPaths.push(emptyPath, stalePath);
    writeFileSync(emptyPath, '');
    writeFileSync(stalePath, 'pg_dump fixture');

    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: productionUrl,
        expectedUrl: productionUrl,
        backupPath: emptyPath,
        requireBackup: true,
      })
    ).toThrow('must not be empty');
    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: productionUrl,
        expectedUrl: productionUrl,
        backupPath: stalePath,
        requireBackup: true,
        now: new Date(Date.now() + 25 * 60 * 60 * 1000),
      })
    ).toThrow('more than 24 hours old');
    expect(() =>
      validatePlayerIdentityFirestoreProject({
        expectedProjectId: 'statly-production',
        actualProjectId: 'statly-staging',
      })
    ).toThrow('Firestore project mismatch');
    expect(
      validatePlayerIdentityFirestoreProject({
        expectedProjectId: 'statly-production',
        actualProjectId: 'statly-production',
      })
    ).toBe('statly-production');
  });
});
