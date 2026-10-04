import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';

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

  if (manifestIndex >= 0 && (!manifestPath || manifestPath.startsWith('--'))) {
    throw new Error('--manifest requires a file path');
  }
  if (propose && (apply || manifestPath || projectWaivers)) {
    throw new Error('--propose cannot be combined with --apply, --manifest, or --project-waivers');
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
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(normalizedRows)).digest('hex');
}

export function assertPlayerIdentitySourceFingerprint(
  expectedFingerprint: string,
  players: readonly PlayerIdentitySourceRow[]
): void {
  if (createPlayerIdentitySourceFingerprint(players) !== expectedFingerprint) {
    throw new Error(
      'Player identity data changed after manifest proposal; generate and review a new manifest'
    );
  }
}

export function validatePlayerIdentityFirestoreProject(input: {
  expectedProjectId: string;
  actualProjectId: string | undefined;
}): string {
  const expectedProjectId = input.expectedProjectId.trim();
  const actualProjectId = input.actualProjectId?.trim();
  if (!expectedProjectId) {
    throw new Error('STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT is required for projection');
  }
  if (!actualProjectId || actualProjectId !== expectedProjectId) {
    throw new Error(
      `Firestore project mismatch: expected ${expectedProjectId}, resolved ${actualProjectId || 'unknown'}`
    );
  }
  return actualProjectId;
}

// Development and test databases are never consolidation targets.
const PROTECTED_DATABASE = /^statly_fantasy_(dev|test)$/;
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parsePostgresUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a postgresql:// URL`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${label} must be a postgresql:// URL`);
  }
  return url;
}

const databaseName = (url: URL) => decodeURIComponent(url.pathname.replace(/^\//, ''));

function assertSameDatabase(actual: URL, expected: URL, message: string): void {
  if (actual.host !== expected.host || databaseName(actual) !== databaseName(expected)) {
    throw new Error(message);
  }
}

export function validateDisposablePlayerIdentityDatabase(input: {
  databaseUrl: string;
  expectedUrl: string;
}): string {
  const databaseUrl = input.databaseUrl.trim();
  const expectedUrl = input.expectedUrl.trim();
  if (!databaseUrl || !expectedUrl) {
    throw new Error('DATABASE_URL and STATLY_VERIFY_DB are required');
  }

  const actual = parsePostgresUrl(databaseUrl, 'DATABASE_URL');
  assertSameDatabase(
    actual,
    parsePostgresUrl(expectedUrl, 'STATLY_VERIFY_DB'),
    'DATABASE_URL must exactly match STATLY_VERIFY_DB'
  );
  if (!/^statly_verify_player_[a-z0-9_]+$/.test(databaseName(actual))) {
    throw new Error('Identity consolidation is restricted to statly_verify_player_* databases');
  }

  return databaseUrl;
}

export function validateProductionPlayerIdentityDatabase(input: {
  databaseUrl: string;
  expectedUrl: string;
  backupPath?: string;
  requireBackup: boolean;
  now?: Date;
}): string {
  const databaseUrl = input.databaseUrl.trim();
  const expectedUrl = input.expectedUrl.trim();
  if (!databaseUrl || !expectedUrl) {
    throw new Error('DATABASE_URL and STATLY_PLAYER_IDENTITY_PRODUCTION_DB are required');
  }

  const actual = parsePostgresUrl(databaseUrl, 'DATABASE_URL');
  assertSameDatabase(
    actual,
    parsePostgresUrl(expectedUrl, 'STATLY_PLAYER_IDENTITY_PRODUCTION_DB'),
    'DATABASE_URL must exactly match STATLY_PLAYER_IDENTITY_PRODUCTION_DB'
  );
  if (PROTECTED_DATABASE.test(databaseName(actual))) {
    throw new Error('Refusing to use the development or test database');
  }

  if (input.requireBackup) {
    const backupPath = input.backupPath?.trim();
    if (!backupPath) {
      throw new Error('STATLY_PLAYER_IDENTITY_BACKUP is required for production apply');
    }
    let backupStat;
    try {
      backupStat = lstatSync(backupPath);
    } catch {
      throw new Error('Production backup must exist and be readable');
    }
    if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
      throw new Error('Production backup must be a regular non-symlink file');
    }
    if (backupStat.size === 0) {
      throw new Error('Production backup must not be empty');
    }
    if ((input.now ?? new Date()).getTime() - backupStat.mtimeMs > BACKUP_MAX_AGE_MS) {
      throw new Error('Production backup is more than 24 hours old; create a fresh pg_dump');
    }
  }

  return databaseUrl;
}
