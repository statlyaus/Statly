import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { PlayerAliasMapping } from './playerIdentityConsolidationPlanner';

export type PlayerIdentityCliArgs = {
  apply: boolean;
  projectWaivers: boolean;
  propose: boolean;
  production: boolean;
  manifestPath?: string;
};

export type ReviewedPlayerIdentityManifest = {
  schemaVersion: 1;
  reviewed: boolean;
  sourceFingerprint: string;
  reviewedAt?: string;
  reviewedBy?: string;
  mappings: PlayerAliasMapping[];
};

export type PlayerIdentitySourceRow = {
  id: string;
  name: string;
  club: string;
  position: string | null;
};

export function parsePlayerIdentityCliArgs(argv: readonly string[]): PlayerIdentityCliArgs {
  const apply = argv.includes('--apply');
  const projectWaivers = argv.includes('--project-waivers');
  const propose = argv.includes('--propose');
  const production = argv.includes('--production');
  const manifestIndex = argv.indexOf('--manifest');
  const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : undefined;

  if (propose && (apply || manifestPath || projectWaivers)) {
    throw new Error('--propose cannot be combined with --apply or --manifest');
  }
  if (projectWaivers && (apply || propose || manifestPath)) {
    throw new Error('--project-waivers must be run as a standalone mode');
  }
  if (projectWaivers && !production) {
    throw new Error('--project-waivers requires --production');
  }
  if (production && !propose && !apply && !projectWaivers && !manifestPath) {
    throw new Error('--production requires a consolidation mode');
  }
  if (!propose && !projectWaivers && !manifestPath) {
    throw new Error('Use --propose or provide --manifest <reviewed-manifest.json>');
  }
  if (manifestIndex >= 0 && (!manifestPath || manifestPath.startsWith('--'))) {
    throw new Error('--manifest requires a file path');
  }

  return {
    apply,
    projectWaivers,
    propose,
    production,
    ...(manifestPath ? { manifestPath } : {}),
  };
}

export function validateReviewedPlayerIdentityManifest(
  value: unknown
): ReviewedPlayerIdentityManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Identity manifest must be a JSON object');
  }

  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) {
    throw new Error('Identity manifest schemaVersion must be 1');
  }
  if (typeof manifest.reviewed !== 'boolean') {
    throw new Error('Identity manifest reviewed must be a boolean');
  }
  if (
    typeof manifest.sourceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint)
  ) {
    throw new Error('Identity manifest sourceFingerprint must be a SHA-256 hex digest');
  }
  if (manifest.reviewed === true) {
    if (typeof manifest.reviewedBy !== 'string' || !manifest.reviewedBy.trim()) {
      throw new Error('Reviewed identity manifests require reviewedBy');
    }
    if (
      typeof manifest.reviewedAt !== 'string' ||
      !manifest.reviewedAt.trim() ||
      Number.isNaN(Date.parse(manifest.reviewedAt))
    ) {
      throw new Error('Reviewed identity manifests require a valid reviewedAt timestamp');
    }
  }
  if (!Array.isArray(manifest.mappings)) {
    throw new Error('Identity manifest mappings must be an array');
  }

  const mappings = manifest.mappings.map((mapping, index) => {
    if (!mapping || typeof mapping !== 'object') {
      throw new Error(`Identity mapping ${index} must be an object`);
    }
    const row = mapping as Record<string, unknown>;
    if (
      typeof row.aliasId !== 'string' ||
      !row.aliasId.trim() ||
      typeof row.canonicalPlayerId !== 'string' ||
      !row.canonicalPlayerId.trim()
    ) {
      throw new Error(`Identity mapping ${index} requires aliasId and canonicalPlayerId`);
    }
    if (row.aliasId.trim() === row.canonicalPlayerId.trim()) {
      throw new Error(`Identity mapping ${index} cannot map a player to itself`);
    }
    return {
      aliasId: row.aliasId.trim(),
      canonicalPlayerId: row.canonicalPlayerId.trim(),
    };
  });

  return {
    schemaVersion: 1,
    reviewed: manifest.reviewed,
    sourceFingerprint: manifest.sourceFingerprint,
    ...(typeof manifest.reviewedAt === 'string' ? { reviewedAt: manifest.reviewedAt } : {}),
    ...(typeof manifest.reviewedBy === 'string' ? { reviewedBy: manifest.reviewedBy.trim() } : {}),
    mappings,
  };
}

export function createPlayerIdentitySourceFingerprint(
  players: readonly PlayerIdentitySourceRow[]
): string {
  const normalizedRows = [...players]
    .map((player) => ({
      id: player.id,
      name: player.name,
      club: player.club,
      position: player.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(normalizedRows)).digest('hex');
}

export function validateDisposablePlayerIdentityDatabase(input: {
  databaseUrl: string;
  expectedPath: string;
  repositoryRoot?: string;
}): string {
  const databaseUrl = input.databaseUrl.trim();
  const expectedPath = input.expectedPath.trim();
  if (!databaseUrl || !expectedPath) {
    throw new Error('DATABASE_URL and STATLY_VERIFY_DB are required');
  }

  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== 'file:' || parsedUrl.host || parsedUrl.search || parsedUrl.hash) {
    throw new Error('Identity consolidation requires a plain local file: URL');
  }

  const databasePath = path.normalize(decodeURIComponent(parsedUrl.pathname));
  const normalizedExpectedPath = path.normalize(expectedPath);
  if (
    databasePath !== normalizedExpectedPath ||
    !/^\/tmp\/statly-verify-player-[^/]+\.db$/.test(normalizedExpectedPath)
  ) {
    throw new Error(
      'Identity consolidation is restricted to matching /tmp/statly-verify-player-*.db files'
    );
  }

  const stat = lstatSync(normalizedExpectedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Identity verification database must be a regular non-symlink file');
  }

  const realDatabasePath = realpathSync(normalizedExpectedPath);
  const protectedDatabasePath = realpathSync(
    path.resolve(input.repositoryRoot ?? process.cwd(), 'prisma/dev.db')
  );
  if (realDatabasePath === protectedDatabasePath) {
    throw new Error('Refusing to use protected prisma/dev.db');
  }

  return databaseUrl;
}

export function validateProductionPlayerIdentityDatabase(input: {
  databaseUrl: string;
  expectedPath: string;
  backupPath?: string;
  requireBackup: boolean;
  repositoryRoot?: string;
}): string {
  const databaseUrl = input.databaseUrl.trim();
  const expectedPath = input.expectedPath.trim();
  if (!databaseUrl || !expectedPath) {
    throw new Error('DATABASE_URL and STATLY_PLAYER_IDENTITY_PRODUCTION_DB are required');
  }

  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== 'file:' || parsedUrl.host || parsedUrl.search || parsedUrl.hash) {
    throw new Error('Production identity consolidation requires a plain local file: URL');
  }

  const databasePath = path.normalize(decodeURIComponent(parsedUrl.pathname));
  const normalizedExpectedPath = path.normalize(expectedPath);
  if (databasePath !== normalizedExpectedPath) {
    throw new Error('DATABASE_URL must exactly match STATLY_PLAYER_IDENTITY_PRODUCTION_DB');
  }

  const stat = lstatSync(normalizedExpectedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Production identity database must be a regular non-symlink file');
  }

  const realDatabasePath = realpathSync(normalizedExpectedPath);
  const protectedDatabasePath = realpathSync(
    path.resolve(input.repositoryRoot ?? process.cwd(), 'prisma/dev.db')
  );
  if (realDatabasePath === protectedDatabasePath) {
    throw new Error('Refusing to use protected prisma/dev.db');
  }

  if (input.requireBackup) {
    const backupPath = input.backupPath?.trim();
    if (!backupPath) {
      throw new Error('STATLY_PLAYER_IDENTITY_BACKUP is required for production apply');
    }
    const backupStat = lstatSync(backupPath);
    if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
      throw new Error('Production backup must be a regular non-symlink file');
    }
    if (realpathSync(backupPath) === realDatabasePath) {
      throw new Error('Production backup must be a separate file');
    }
  }

  return databaseUrl;
}
