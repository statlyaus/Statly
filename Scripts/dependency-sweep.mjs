import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const REVIEW_PACKAGES = new Set([
  'firebase-functions',
  'inngest',
  'next',
  'openai',
  'react',
  'react-dom',
]);

const WORKSPACES = [
  {
    cwd: '.',
    manifestPath: 'package.json',
    workspace: 'root',
  },
  {
    cwd: 'etl',
    manifestPath: 'etl/package.json',
    workspace: 'etl',
  },
  {
    cwd: 'functions',
    manifestPath: 'functions/package.json',
    workspace: 'functions',
  },
];

function resolveRepoPath(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

export function normalizeVersion(version) {
  return String(version ?? '').replace(/^[^0-9]*/, '');
}

export function classifyDependencyUpgrade(candidate) {
  if (REVIEW_PACKAGES.has(candidate.name)) {
    return {
      lane: 'review',
      reason: 'package is pinned to explicit migration review policy',
    };
  }

  const currentMajor = Number(normalizeVersion(candidate.current).split('.')[0] ?? '0');
  const latestMajor = Number(normalizeVersion(candidate.latest).split('.')[0] ?? '0');

  if (latestMajor > currentMajor) {
    return {
      lane: 'hold',
      reason: 'major version change requires dedicated migration review',
    };
  }

  return {
    lane: 'safe',
    reason: 'same major version; patch/minor candidate',
  };
}

export function readManifest({ workspace, manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(resolveRepoPath(manifestPath), 'utf8'));

  return {
    workspace,
    manifestPath,
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
  };
}

export function buildFixtureManifests() {
  return [
    {
      workspace: 'root',
      manifestPath: 'package.json',
      dependencies: {
        'firebase-admin': '13.6.0',
        dotenv: '^17.2.2',
        next: '15.5.3',
        openai: '5.20.2',
      },
      devDependencies: {},
    },
    {
      workspace: 'etl',
      manifestPath: 'etl/package.json',
      dependencies: {
        'firebase-admin': '13.8.0',
        dotenv: '^17.4.1',
      },
      devDependencies: {},
    },
    {
      workspace: 'functions',
      manifestPath: 'functions/package.json',
      dependencies: {
        'firebase-admin': '13.8.0',
        'firebase-functions': '6.6.0',
      },
      devDependencies: {},
    },
  ];
}

function mergeWorkspaceDependencies(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
}

export function buildDependencyRows(manifests) {
  const rows = new Map();

  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(mergeWorkspaceDependencies(manifest))) {
      const existing = rows.get(name) ?? { name, workspaces: {} };
      existing.workspaces[manifest.workspace] = version;
      rows.set(name, existing);
    }
  }

  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function parseOutdatedStdout(stdout) {
  if (!stdout.trim()) {
    return {};
  }

  return JSON.parse(stdout);
}

export function loadWorkspaceOutdated({ cwd, workspace }) {
  const result = spawnSync('npm', ['outdated', '--json', '--long'], {
    cwd: resolveRepoPath(cwd),
    encoding: 'utf8',
    timeout: 60_000,
  });

  if (result.error) {
    return {
      candidates: [],
      warnings: [`${workspace}: npm outdated failed: ${result.error.message}`],
    };
  }

  if (result.status !== 0 && result.status !== 1) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return {
      candidates: [],
      warnings: [`${workspace}: npm outdated failed: ${detail}`],
    };
  }

  let parsed;

  try {
    parsed = parseOutdatedStdout(result.stdout);
  } catch (error) {
    return {
      candidates: [],
      warnings: [`${workspace}: npm outdated returned invalid JSON: ${error.message}`],
    };
  }

  const candidates = Object.entries(parsed)
    .map(([name, details]) => {
      const current = details.current ?? details.wanted ?? '';
      const latest = details.latest ?? details.wanted ?? current;
      const classification = classifyDependencyUpgrade({
        name,
        current,
        latest,
        workspace,
      });

      return {
        current,
        latest,
        name,
        reason: classification.reason,
        lane: classification.lane,
        type: details.type ?? 'dependencies',
        workspace,
      };
    })
    .sort((left, right) => {
      return left.workspace.localeCompare(right.workspace) || left.name.localeCompare(right.name);
    });

  return { candidates, warnings: [] };
}

export function collectWorkspaceOutdated(workspaces = WORKSPACES) {
  const warnings = [];
  const candidates = [];

  for (const workspace of workspaces) {
    const result = loadWorkspaceOutdated(workspace);
    warnings.push(...result.warnings);
    candidates.push(...result.candidates);
  }

  return { candidates, warnings };
}

export function formatDependencyReport(report) {
  const lines = [
    '# Dependency Sweep Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Manifest Versions',
    '',
    '| Package | Root | ETL | Functions |',
    '| --- | --- | --- | --- |',
    ...report.packageRows.map((row) => {
      return `| ${row.name} | ${row.workspaces.root ?? '-'} | ${row.workspaces.etl ?? '-'} | ${row.workspaces.functions ?? '-'} |`;
    }),
    '',
    '## Upgrade Candidates',
    '',
    '| Workspace | Package | Current | Latest | Lane | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(report.upgradeCandidates.length > 0
      ? report.upgradeCandidates.map((candidate) => {
          return `| ${candidate.workspace} | ${candidate.name} | ${candidate.current} | ${candidate.latest} | ${candidate.lane} | ${candidate.reason} |`;
        })
      : ['| - | - | - | - | - | no upgrade candidates detected |']),
  ];

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const useFixtures = argv.includes('--fixtures');
  const manifests = useFixtures ? buildFixtureManifests() : WORKSPACES.map(readManifest);
  const outdated = useFixtures
    ? {
        candidates: [
          {
            name: 'firebase-admin',
            workspace: 'root',
            current: '13.6.0',
            latest: '13.8.0',
            lane: 'safe',
            reason: 'same major version; patch/minor candidate',
          },
          {
            name: 'openai',
            workspace: 'root',
            current: '5.20.2',
            latest: '5.21.0',
            lane: 'review',
            reason: 'package is pinned to explicit migration review policy',
          },
        ],
        warnings: [],
      }
    : collectWorkspaceOutdated(WORKSPACES);

  const report = formatDependencyReport({
    generatedAt: new Date().toISOString(),
    packageRows: buildDependencyRows(manifests),
    upgradeCandidates: outdated.candidates,
    warnings: outdated.warnings,
  });

  process.stdout.write(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
