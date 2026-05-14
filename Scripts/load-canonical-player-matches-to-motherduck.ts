#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { readFileSync } from 'node:fs';

import {
  createMotherDuckClient,
  type WarehouseQueryRunner,
} from '../src/lib/warehouse/motherduckClient';
import { CANONICAL_PLAYER_MATCH_WAREHOUSE_COLUMNS } from '../src/lib/warehouse/motherduckSql';

type CanonicalPlayerMatchExportManifest = {
  loadId: string;
  ndjsonPath: string;
  exportedRows: number;
  rejectedRows: number;
  artifactSha256: string;
};

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);

  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readManifest(
  manifestPath: string
): CanonicalPlayerMatchExportManifest {
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8')
  ) as Partial<CanonicalPlayerMatchExportManifest>;

  if (typeof manifest.loadId !== 'string' || manifest.loadId.length === 0) {
    throw new Error('Manifest loadId is required');
  }
  if (
    typeof manifest.ndjsonPath !== 'string' ||
    manifest.ndjsonPath.length === 0
  ) {
    throw new Error('Manifest ndjsonPath is required');
  }
  if (
    typeof manifest.exportedRows !== 'number' ||
    !Number.isInteger(manifest.exportedRows) ||
    manifest.exportedRows < 0
  ) {
    throw new Error('Manifest exportedRows must be a finite non-negative integer');
  }
  if (
    typeof manifest.rejectedRows !== 'number' ||
    !Number.isInteger(manifest.rejectedRows) ||
    manifest.rejectedRows < 0
  ) {
    throw new Error('Manifest rejectedRows must be a finite non-negative integer');
  }
  if (manifest.rejectedRows > 0) {
    throw new Error(
      `Refusing to load manifest with rejectedRows > 0: ${manifest.rejectedRows}`
    );
  }
  if (
    typeof manifest.artifactSha256 !== 'string' ||
    manifest.artifactSha256.length === 0
  ) {
    throw new Error('Manifest artifactSha256 is required');
  }

  return {
    loadId: manifest.loadId,
    ndjsonPath: manifest.ndjsonPath,
    exportedRows: manifest.exportedRows,
    rejectedRows: manifest.rejectedRows,
    artifactSha256: manifest.artifactSha256,
  };
}

function buildStagingTableName(loadId: string): string {
  return `staging_canonical_player_match_${loadId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath = readArg(argv, '--manifest');
  if (!manifestPath) throw new Error('Expected --manifest path');

  const dryRun = argv.includes('--dry-run');
  const schema = readArg(argv, '--schema') ?? 'statly_warehouse';
  const manifest = readManifest(manifestPath);
  const stagingTableName = buildStagingTableName(manifest.loadId);

  const runner: WarehouseQueryRunner = {
    async query(sql) {
      if (dryRun) {
        console.log(JSON.stringify({ dryRun: true, sql }, null, 2));
        return [];
      }

      throw new Error(
        'Real MotherDuck runner is intentionally not wired yet; rerun with --dry-run to render SQL safely'
      );
    },
  };

  const client = createMotherDuckClient({ runner, schemaName: schema });
  await client.ensureSchema();
  await client.validateRequiredColumns(
    'canonical_player_match',
    CANONICAL_PLAYER_MATCH_WAREHOUSE_COLUMNS
  );
  await client.mergeCanonicalPlayerMatches(stagingTableName);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        schema,
        stagingTableName,
        exportedRows: manifest.exportedRows,
        ndjsonPath: manifest.ndjsonPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
