#!/usr/bin/env node

/**
 * Clean Player Data Script
 * - Normalizes player names by removing arrow symbols
 * - Deduplicates entries by cleaned name (and team)
 * - Provides CLI flags for input/output, dry-run, and keep strategy
 *
 * Usage:
 *   node Scripts/clean-player-data.js [--in path] [--out path] [--overwrite] [--dry-run] [--keep first|last]
 */

import fs from 'fs/promises';
import path from 'path';

const DEFAULT_INPUT = 'player_stats_2025.json';

function parseArgs(argv) {
  const args = { in: DEFAULT_INPUT, out: undefined, overwrite: false, dryRun: false, keep: 'first' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in' && argv[i + 1]) args.in = argv[++i];
    else if (a === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (a === '--overwrite') args.overwrite = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep' && argv[i + 1]) {
      const v = argv[++i];
      args.keep = v === 'last' ? 'last' : 'first';
    }
  }
  return args;
}

// Expanded set of arrow/indicator symbols
const ARROW_REGEX = /[↗↙↘↖↑↓▲▼⇧⇩]/g;

function cleanName(name) {
  if (!name || typeof name !== 'string') return null;
  return name.replace(ARROW_REGEX, '').replace(/\s+/g, ' ').trim();
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}

async function cleanPlayerData() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(process.cwd(), args.in);
  const outPath = args.out
    ? path.resolve(process.cwd(), args.out)
    : args.overwrite
    ? inputPath
    : path.resolve(process.cwd(), inputPath.replace(/\.json$/i, '.cleaned.json'));

  console.log('🧹 Starting player data cleanup...');
  console.log(`   input: ${inputPath}`);
  console.log(`   output: ${outPath}${args.dryRun ? ' (dry-run)' : ''}`);
  console.log(`   strategy: keep ${args.keep}`);

  let data;
  try {
    data = await readJson(inputPath);
  } catch (e) {
    console.error('❌ Failed to read or parse input JSON:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('❌ Input JSON must be an array of records.');
    process.exit(1);
  }

  console.log(`📊 Original entries: ${data.length}`);

  // Track variations and dedupe
  const playerVariations = new Map(); // cleanName -> Set(original variants)
  const keptMap = new Map(); // key(cleanName|team) -> entry

  let invalidCount = 0;
  let duplicateCount = 0;

  for (const entry of data) {
    const originalName = entry?.Player;
    const cleaned = cleanName(originalName);

    if (!cleaned) {
      invalidCount++;
      continue;
    }

    // Track variations
    if (!playerVariations.has(cleaned)) playerVariations.set(cleaned, new Set());
    playerVariations.get(cleaned).add(originalName);

    // Determine grouping key (name + team when available)
    const team = typeof entry?.Team === 'string' ? entry.Team.trim() : '';
    const key = `${cleaned}|${team}`;

    const cleanedEntry = { ...entry, Player: cleaned };

    if (keptMap.has(key)) {
      duplicateCount++;
      if (args.keep === 'last') {
        keptMap.set(key, cleanedEntry);
      }
      // if 'first', keep existing
    } else {
      keptMap.set(key, cleanedEntry);
    }
  }

  const cleanedData = Array.from(keptMap.values());

  // Report duplicates
  const namesWithDuplicates = Array.from(playerVariations.entries()).filter(([, set]) => set.size > 1);

  console.log(`🔍 Unique cleaned names: ${playerVariations.size}`);
  console.log(`⚠️  Entries without valid Player name: ${invalidCount}`);
  console.log(`⚠️  Deduplicated groups encountered: ${duplicateCount}`);
  console.log(`✅ Final entries after dedupe: ${cleanedData.length}`);

  if (namesWithDuplicates.length > 0) {
    console.log('\n📋 Players with duplicates (name variations):');
    for (const [name, variations] of namesWithDuplicates) {
      console.log(`  ${name}:`);
      for (const v of variations) console.log(`    - "${v}"`);
    }
  }

  if (args.dryRun) {
    console.log('\n🧪 Dry run complete. No files were written.');
    return;
  }

  // Backup if overwriting in place
  if (outPath === inputPath) {
    const backupPath = `${inputPath}.backup`;
    await fs.copyFile(inputPath, backupPath);
    console.log(`💾 Backup created: ${backupPath}`);
  }

  try {
    await writeJson(outPath, cleanedData);
    console.log(`✨ Cleaned data written to: ${outPath}`);
  } catch (e) {
    console.error('❌ Failed to write output JSON:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  console.log('\n🎉 Player data cleanup completed!');
}

cleanPlayerData().catch((e) => {
  console.error('❌ Unexpected error:', e);
  process.exit(1);
});
