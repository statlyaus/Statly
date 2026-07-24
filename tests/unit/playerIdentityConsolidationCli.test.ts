import { symlinkSync, unlinkSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPlayerIdentitySourceFingerprint,
  parsePlayerIdentityCliArgs,
  validateDisposablePlayerIdentityDatabase,
  validateProductionPlayerIdentityDatabase,
  validateReviewedPlayerIdentityManifest,
} from '../../src/server/players/playerIdentityConsolidationCli';

const createdPaths: string[] = [];

function tempDatabasePath(suffix: string): string {
  return `/tmp/statly-verify-player-${process.pid}-${suffix}.db`;
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
    const databasePath = `/tmp/statly-production-player-${process.pid}.db`;
    const backupPath = `/tmp/statly-production-player-${process.pid}.backup.db`;
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
});
