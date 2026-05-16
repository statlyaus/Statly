import { globby } from 'globby';
import { readFile } from 'node:fs/promises';
import {
  designDriftAllowlist,
  type DesignDriftAllowlistEntry,
  type DesignDriftCategory,
} from './design-drift-allowlist.ts';

type FindingCategory = DesignDriftCategory;

type ProductSurface =
  | 'auth'
  | 'dashboard'
  | 'draft'
  | 'league'
  | 'live-scoring'
  | 'players'
  | 'public'
  | 'roster'
  | 'shared-ui'
  | 'team'
  | 'demo'
  | 'other';

type Finding = {
  category: FindingCategory;
  surface: ProductSurface;
  file: string;
  line: number;
  column: number;
  value: string;
  preview: string;
};

type AllowlistEntry = DesignDriftAllowlistEntry;

const SEARCH_GLOBS = ['src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'];
const FILES_PER_CATEGORY_LIMIT = 25;
const FINDINGS_PER_FILE_LIMIT = 6;

const tokenCandidatePattern =
  /\b(?:bg|text|border|ring|from|to|via)-(?:gray|slate|blue|red|green|yellow|purple|orange|cyan|indigo|sky|emerald|rose)-\d{2,3}(?:\/\d+)?\b|#[0-9A-Fa-f]{3,8}/g;

const legacyIconPattern = /@heroicons\/react|react-icons/g;

const ALLOWLIST: AllowlistEntry[] = designDriftAllowlist;

function isStrictMode(): boolean {
  return process.argv.includes('--strict');
}

function isAllowed(finding: Finding): boolean {
  return ALLOWLIST.some((entry) => {
    if (!entry.filePattern.test(finding.file)) return false;
    if (entry.category && entry.category !== finding.category) return false;
    if (entry.valuePattern && !entry.valuePattern.test(finding.value)) return false;
    return true;
  });
}

function classifySurface(file: string): ProductSurface {
  if (file.startsWith('src/components/demos/')) return 'demo';
  if (file.includes('/components/ui/')) return 'shared-ui';
  if (file === 'src/app/page.tsx' || file === 'src/app/fantasy/page.tsx') return 'public';
  if (file.includes('/(auth)/') || file.includes('/Auth')) return 'auth';
  if (file.includes('/draft/') || file.includes('/Draft')) return 'draft';
  if (file.includes('/league/') || file.includes('/leagues/') || file.includes('League')) {
    return 'league';
  }
  if (file.includes('LiveScoring') || file.includes('LiveGameScores')) return 'live-scoring';
  if (file.includes('/players/') || file.includes('/player/') || file.includes('Player')) {
    return 'players';
  }
  if (file.includes('/roster/') || file.includes('Roster') || file.includes('MyTeamPanel')) {
    return 'roster';
  }
  if (file.includes('/team/') || file.includes('Team')) return 'team';
  if (file.includes('/dashboard/') || file.includes('Dashboard')) return 'dashboard';
  return 'other';
}

function findMatches(
  file: string,
  lineText: string,
  line: number,
  category: FindingCategory,
  pattern: RegExp
): Finding[] {
  return Array.from(lineText.matchAll(pattern), (match) => ({
    category,
    surface: classifySurface(file),
    file,
    line,
    column: (match.index ?? 0) + 1,
    value: match[0],
    preview: lineText.trim(),
  }));
}

async function collectFindings(): Promise<Finding[]> {
  const files = await globby(SEARCH_GLOBS, {
    gitignore: true,
    onlyFiles: true,
  });

  const findings: Finding[] = [];

  for (const file of files.sort()) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((lineText, index) => {
      const line = index + 1;
      findings.push(...findMatches(file, lineText, line, 'palette', tokenCandidatePattern));
      findings.push(...findMatches(file, lineText, line, 'legacy-icon', legacyIconPattern));
    });
  }

  return findings;
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();

  for (const finding of findings) {
    const existing = grouped.get(finding.file) ?? [];
    existing.push(finding);
    grouped.set(finding.file, existing);
  }

  return grouped;
}

function printCategory(title: string, findings: Finding[]): void {
  console.log(`\n${title}: ${findings.length} finding(s)`);

  if (!findings.length) return;

  const grouped = groupByFile(findings);
  const entries = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  const shownFiles = entries.slice(0, FILES_PER_CATEGORY_LIMIT);

  for (const [file, fileFindings] of shownFiles) {
    console.log(`\n  ${file} (${fileFindings.length})`);
    for (const finding of fileFindings.slice(0, FINDINGS_PER_FILE_LIMIT)) {
      console.log(`    ${finding.line}:${finding.column} ${finding.value} | ${finding.preview}`);
    }

    const hidden = fileFindings.length - FINDINGS_PER_FILE_LIMIT;
    if (hidden > 0) {
      console.log(`    ... ${hidden} more in this file`);
    }
  }

  const hiddenFiles = entries.length - FILES_PER_CATEGORY_LIMIT;
  if (hiddenFiles > 0) {
    const hiddenFindings = entries
      .slice(FILES_PER_CATEGORY_LIMIT)
      .reduce((total, [, fileFindings]) => total + fileFindings.length, 0);
    console.log(`\n  ... ${hiddenFindings} more finding(s) across ${hiddenFiles} file(s)`);
  }
}

function printSurfaceSummary(findings: Finding[]): void {
  const counts = new Map<ProductSurface, number>();

  for (const finding of findings) {
    counts.set(finding.surface, (counts.get(finding.surface) ?? 0) + 1);
  }

  console.log('\nActive findings by product surface');
  for (const [surface, count] of Array.from(counts.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    console.log(`  ${surface}: ${count}`);
  }
}

function printAllowlistSummary(allowedFindings: Finding[]): void {
  console.log(`\nAllowlisted intentional findings: ${allowedFindings.length}`);

  if (!ALLOWLIST.length) {
    console.log('  No allowlist entries configured.');
    return;
  }

  for (const entry of ALLOWLIST) {
    const count = allowedFindings.filter((finding) => {
      if (!entry.filePattern.test(finding.file)) return false;
      if (entry.category && entry.category !== finding.category) return false;
      if (entry.valuePattern && !entry.valuePattern.test(finding.value)) return false;
      return true;
    }).length;
    console.log(`  ${count} - ${entry.reason}`);
  }
}

async function main(): Promise<void> {
  const strict = isStrictMode();
  const findings = await collectFindings();
  const allowedFindings = findings.filter(isAllowed);
  const activeFindings = findings.filter((finding) => !isAllowed(finding));
  const paletteFindings = activeFindings.filter((finding) => finding.category === 'palette');
  const legacyIconFindings = activeFindings.filter((finding) => finding.category === 'legacy-icon');

  console.log('Design system drift report');
  console.log(`Mode: ${strict ? 'strict' : 'report'}`);
  console.log(`Scanned: ${SEARCH_GLOBS.join(', ')}`);
  console.log(`Active findings: ${activeFindings.length}`);

  printSurfaceSummary(activeFindings);
  printCategory('Hard-coded palette or hex candidates', paletteFindings);
  printCategory('Legacy icon import candidates', legacyIconFindings);
  printAllowlistSummary(allowedFindings);

  if (strict && activeFindings.length > 0) {
    console.error(`\nDesign drift guard failed with ${activeFindings.length} active finding(s).`);
    process.exit(1);
  }

  if (activeFindings.length === 0) {
    console.log('\nNo active design drift findings.');
  } else if (!strict) {
    console.log('\nReport mode only; exiting 0.');
  }
}

main().catch((error) => {
  console.error('check-design-drift failed', error);
  process.exit(1);
});
