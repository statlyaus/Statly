import { symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

function tempDatabasePath(suffix: string): string {
  return join(tmpdir(), `statly-verify-player-${process.pid}-${suffix}.db`);
}

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

  it('accepts only a matching regular disposable database file', () => {
    const databasePath = tempDatabasePath('valid');
    createdPaths.push(databasePath);
    writeFileSync(databasePath, 'sqlite fixture');

    expect(
      validateDisposablePlayerIdentityDatabase({
        databaseUrl: `file:${databasePath}`,
        expectedPath: databasePath,
        repositoryRoot: join(tmpdir(), 'statly-repository-without-dev-db'),
      })
    ).toBe(`file:${databasePath}`);
  });

  it('rejects a disposable-looking symlink', () => {
    const symlinkPath = tempDatabasePath('symlink');
    createdPaths.push(symlinkPath);
    symlinkSync('prisma/dev.db', symlinkPath);

    expect(() =>
      validateDisposablePlayerIdentityDatabase({
        databaseUrl: `file:${symlinkPath}`,
        expectedPath: symlinkPath,
      })
    ).toThrow('regular non-symlink file');
  });

  it('requires an explicitly matched production database and separate backup for apply', () => {
    const databasePath = join(tmpdir(), `statly-production-player-${process.pid}.db`);
    const backupPath = join(tmpdir(), `statly-production-player-${process.pid}.backup.db`);
    createdPaths.push(databasePath, backupPath);
    writeFileSync(databasePath, 'production sqlite fixture');
    writeFileSync(backupPath, 'backup sqlite fixture');

    expect(
      validateProductionPlayerIdentityDatabase({
        databaseUrl: `file:${databasePath}`,
        expectedPath: databasePath,
        backupPath,
        requireBackup: true,
      })
    ).toBe(`file:${databasePath}`);
    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: `file:${databasePath}`,
        expectedPath: databasePath,
        requireBackup: true,
      })
    ).toThrow('BACKUP');
  });

  it('rejects empty backups and mismatched Firestore projects', () => {
    const databasePath = join(tmpdir(), `statly-production-player-${process.pid}-guard.db`);
    const backupPath = join(tmpdir(), `statly-production-player-${process.pid}-empty.db`);
    createdPaths.push(databasePath, backupPath);
    writeFileSync(databasePath, 'production sqlite fixture');
    writeFileSync(backupPath, '');

    expect(() =>
      validateProductionPlayerIdentityDatabase({
        databaseUrl: `file:${databasePath}`,
        expectedPath: databasePath,
        backupPath,
        requireBackup: true,
      })
    ).toThrow('must not be empty');
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
