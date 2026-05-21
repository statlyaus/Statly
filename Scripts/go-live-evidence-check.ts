#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type EvidenceStatus = 'pass' | 'fail' | 'not-run' | 'accepted';

export interface BrowserEvidenceRun {
  browser: string;
  platform: string;
  viewport: string;
  status: EvidenceStatus;
  consoleErrors: number;
  failedNetworkRequests: number;
  evidenceUrl?: string;
}

export interface CommandEvidenceRun {
  command: string;
  status: EvidenceStatus;
  evidenceUrl?: string;
}

export interface FixtureEvidence {
  datasetVersion: string;
  smokeAccountEmail: string;
  leagueId: string;
  draftId: string;
}

export interface RouteCoverageEvidence {
  route: string;
  status: EvidenceStatus;
  authMode: string;
  evidenceUrl?: string;
}

export interface AccessibilityEvidence {
  status: EvidenceStatus;
  keyboard: boolean;
  namedControls: boolean;
  desktop: boolean;
  mobile: boolean;
  evidenceUrl?: string;
}

export interface WorkflowEvidenceRun {
  id: string;
  status: EvidenceStatus;
  desktop: boolean;
  mobile: boolean;
  accountRole: string;
  evidenceUrl?: string;
}

export interface PerformanceEvidence {
  environment: string;
  source: string;
  status: EvidenceStatus;
  metrics: Partial<Record<'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB', number>>;
  evidenceUrl?: string;
}

export interface DegradedStateEvidence {
  id: string;
  environment: string;
  status: EvidenceStatus;
  evidenceUrl?: string;
}

export interface AcceptedRiskEvidence {
  id: string;
  status: 'accepted' | 'closed';
  owner?: string;
  reason?: string;
  mitigation?: string;
  expiry?: string;
  rollbackSignal?: string;
}

export interface LaunchBlockerEvidence {
  id: string;
  severity: string;
  status: 'open' | 'closed' | 'accepted';
  description: string;
  retestEvidenceUrl?: string;
}

export interface FinalRecommendationEvidence {
  decision: 'go' | 'no-go' | 'go-with-accepted-risks';
  rationale: string;
  rollbackPlan: string;
  postDeploySmokePlan: string;
}

export interface GoLiveEvidenceDocument {
  releaseId: string;
  commitSha: string;
  testDate: string;
  tester: string;
  environment: string;
  baseUrl: string;
  fixture: FixtureEvidence;
  commandEvidence: CommandEvidenceRun[];
  routeCoverage: RouteCoverageEvidence[];
  accessibility: AccessibilityEvidence;
  browserRuns: BrowserEvidenceRun[];
  workflows: WorkflowEvidenceRun[];
  performance: PerformanceEvidence;
  degradedStates: DegradedStateEvidence[];
  acceptedRisks: AcceptedRiskEvidence[];
  launchBlockers: LaunchBlockerEvidence[];
  finalRecommendation: FinalRecommendationEvidence;
}

export interface GoLiveEvidenceResult {
  ok: boolean;
  blockers: string[];
  summary: {
    releaseId: string | null;
    commitSha: string | null;
    environment: string | null;
    commandEvidence: number;
    routeCoverage: number;
    browserRuns: number;
    workflows: number;
    degradedStates: number;
    acceptedRisks: number;
    launchBlockers: number;
    finalDecision: string | null;
  };
}

export interface EvidenceArgs {
  filePath?: string;
  init: boolean;
  outputPath?: string;
}

export interface EvidenceInitConfig {
  releaseId: string;
  environment: string;
  baseUrl: string;
  smokeAccountEmail: string;
  smokeLeagueId: string;
  smokeDraftId: string;
  buildId: string;
}

const REQUIRED_BROWSERS = ['chrome', 'safari', 'firefox', 'mobile-safari', 'chrome-android'];
const REQUIRED_COMMANDS = [
  'npm run typecheck',
  'npm run lint',
  'npm run guard:routes',
  'npm run guard:design',
  'npm test',
  'npm run branch:complete',
];
const REQUIRED_ROUTES = [
  '/',
  '/login',
  '/dashboard',
  '/players',
  '/rankings',
  '/leagues/:leagueId',
  '/drafts/:draftId',
  '/admin/workers',
];
const REQUIRED_WORKFLOWS = [
  'auth-session',
  'dashboard',
  'league-switch',
  'draft-room',
  'trade-review',
  'waiver-flow',
  'player-rankings',
  'admin-denial',
];
const REQUIRED_PERFORMANCE_METRICS = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;

const readArgValue = (argv: string[], name: string): string | undefined => {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const normalize = (value: string): string => value.trim().toLowerCase();
const isPass = (status: EvidenceStatus): boolean => status === 'pass';
const isStagingLike = (environment: string): boolean => ['staging', 'preview'].includes(normalize(environment));
const isExampleRelease = (releaseId: string): boolean => normalize(releaseId).includes('example');

export function parseEvidenceArgs(argv: string[]): EvidenceArgs {
  return {
    init: argv.includes('--init'),
    filePath: readArgValue(argv, '--file') ?? argv[0],
    outputPath: readArgValue(argv, '--output'),
  };
}

type EnvLike = Record<string, string | undefined>;

const readFirst = (argv: string[], env: EnvLike, names: string[]): string | undefined => {
  for (const name of names) {
    if (name.startsWith('--')) {
      const value = readArgValue(argv, name);
      if (value?.trim()) return value.trim();
    } else {
      const value = env[name];
      if (value?.trim()) return value.trim();
    }
  }

  return undefined;
};

export function parseEvidenceInitConfig(
  argv: string[],
  env: EnvLike = process.env
): EvidenceInitConfig {
  return {
    releaseId:
      readFirst(argv, env, ['--release-id', 'GO_LIVE_BUILD_ID', 'RELEASE_ID', 'VERCEL_GIT_COMMIT_SHA']) ??
      '<release-id>',
    environment: readFirst(argv, env, ['--environment', 'GO_LIVE_EVIDENCE_ENVIRONMENT']) ?? 'staging',
    baseUrl: readFirst(argv, env, ['--base-url', 'GO_LIVE_BASE_URL', 'STAGING_BASE_URL']) ?? '<base-url>',
    smokeAccountEmail:
      readFirst(argv, env, [
        '--smoke-account',
        'GO_LIVE_SMOKE_ACCOUNT_EMAIL',
        'STAGING_SMOKE_ACCOUNT_EMAIL',
      ]) ?? '<smoke-account-email>',
    smokeLeagueId:
      readFirst(argv, env, ['--league-id', 'GO_LIVE_SMOKE_LEAGUE_ID', 'STAGING_SMOKE_LEAGUE_ID']) ??
      '<league-id>',
    smokeDraftId:
      readFirst(argv, env, ['--draft-id', 'GO_LIVE_SMOKE_DRAFT_ID', 'STAGING_SMOKE_DRAFT_ID']) ??
      '<draft-id>',
    buildId:
      readFirst(argv, env, ['--build-id', 'GO_LIVE_BUILD_ID', 'RELEASE_ID', 'VERCEL_GIT_COMMIT_SHA']) ??
      '<build-id>',
  };
}

export function buildEvidenceScaffold(config: EvidenceInitConfig): GoLiveEvidenceDocument {
  const evidenceBase = `replace-with-evidence-url/${config.releaseId}`;
  const desktopBrowsers = new Set(['chrome', 'safari', 'firefox']);

  return {
    releaseId: config.releaseId,
    commitSha: config.buildId,
    testDate: new Date().toISOString().slice(0, 10),
    tester: '<tester>',
    environment: config.environment,
    baseUrl: config.baseUrl,
    fixture: {
      datasetVersion: '<fixture-dataset-version>',
      smokeAccountEmail: config.smokeAccountEmail,
      leagueId: config.smokeLeagueId,
      draftId: config.smokeDraftId,
    },
    commandEvidence: REQUIRED_COMMANDS.map((command) => ({
      command,
      status: 'not-run',
      evidenceUrl: `${evidenceBase}/command-${command.replaceAll(' ', '-')}`,
    })),
    routeCoverage: REQUIRED_ROUTES.map((route) => ({
      route,
      status: 'not-run',
      authMode: route === '/admin/workers' ? 'standard-user-denied' : 'smoke-user',
      evidenceUrl: `${evidenceBase}/route-${route.replaceAll('/', '-') || 'home'}`,
    })),
    accessibility: {
      status: 'not-run',
      keyboard: false,
      namedControls: false,
      desktop: false,
      mobile: false,
      evidenceUrl: `${evidenceBase}/accessibility`,
    },
    browserRuns: REQUIRED_BROWSERS.map((browser) => ({
      browser,
      platform: desktopBrowsers.has(browser) ? 'desktop' : 'mobile',
      viewport: desktopBrowsers.has(browser) ? '1440x900' : '390x844',
      status: 'not-run',
      consoleErrors: 0,
      failedNetworkRequests: 0,
      evidenceUrl: `${evidenceBase}/browser-${browser}`,
    })),
    workflows: REQUIRED_WORKFLOWS.map((workflow) => ({
      id: workflow,
      status: 'not-run',
      desktop: false,
      mobile: false,
      accountRole: workflow === 'admin-denial' ? 'standard-user' : config.smokeAccountEmail,
      evidenceUrl: `${evidenceBase}/workflow-${workflow}`,
    })),
    performance: {
      environment: config.environment,
      source: 'web-vitals',
      status: 'not-run',
      metrics: {},
      evidenceUrl: `${evidenceBase}/performance-web-vitals`,
    },
    degradedStates: [
      {
        id: 'dashboard-api-failure',
        environment: config.environment,
        status: 'not-run',
        evidenceUrl: `${evidenceBase}/degraded-dashboard-api-failure`,
      },
    ],
    acceptedRisks: [],
    launchBlockers: [],
    finalRecommendation: {
      decision: 'no-go',
      rationale: '',
      rollbackPlan: '',
      postDeploySmokePlan: '',
    },
  };
}

function pushMissingText(blockers: string[], field: string, value: unknown) {
  if (!hasText(value)) {
    blockers.push(`${field} is required.`);
  }
}

function pushInvalidEvidenceUrl(
  blockers: string[],
  evidence: GoLiveEvidenceDocument,
  field: string,
  value: unknown
) {
  pushMissingText(blockers, field, value);

  if (!hasText(value) || isExampleRelease(evidence.releaseId)) {
    return;
  }

  const text = String(value).trim().toLowerCase();
  if (
    text.includes('replace-with-evidence-url') ||
    text.includes('.example') ||
    text.includes('<') ||
    text.includes('>')
  ) {
    blockers.push(`${field} must be a real evidence URL.`);
  }
}

function validateBrowserRuns(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const runsByBrowser = new Map(evidence.browserRuns.map((run) => [normalize(run.browser), run]));

  for (const browser of REQUIRED_BROWSERS) {
    const run = runsByBrowser.get(browser);
    if (!run) {
      blockers.push(`browser matrix is missing ${browser}.`);
      continue;
    }

    if (!isPass(run.status)) {
      blockers.push(`browser ${browser} did not pass.`);
    }

    if (run.consoleErrors > 0) {
      blockers.push(`browser ${browser} recorded ${run.consoleErrors} console errors.`);
    }

    if (run.failedNetworkRequests > 0) {
      blockers.push(
        `browser ${browser} recorded ${run.failedNetworkRequests} failed network requests.`
      );
    }

    pushInvalidEvidenceUrl(blockers, evidence, `browser ${browser} evidenceUrl`, run.evidenceUrl);
  }
}

function validateCommandEvidence(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const commandEvidence = evidence.commandEvidence ?? [];
  const commandsByName = new Map(
    commandEvidence.map((entry) => [normalize(entry.command), entry])
  );

  for (const command of REQUIRED_COMMANDS) {
    const entry = commandsByName.get(normalize(command));
    if (!entry) {
      blockers.push(`command evidence is missing ${command}.`);
      continue;
    }

    if (!isPass(entry.status)) {
      blockers.push(`command evidence ${command} did not pass.`);
    }

    pushInvalidEvidenceUrl(blockers, evidence, `command evidence ${command} evidenceUrl`, entry.evidenceUrl);
  }
}

function validateFixtureEvidence(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const fixture = evidence.fixture;

  if (!fixture) {
    blockers.push('fixture evidence is required.');
    return;
  }

  pushMissingText(blockers, 'fixture datasetVersion', fixture.datasetVersion);
  pushMissingText(blockers, 'fixture smokeAccountEmail', fixture.smokeAccountEmail);
  pushMissingText(blockers, 'fixture leagueId', fixture.leagueId);
  pushMissingText(blockers, 'fixture draftId', fixture.draftId);
}

function validateRouteCoverage(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const routeCoverage = evidence.routeCoverage ?? [];
  const coverageByRoute = new Map(routeCoverage.map((entry) => [entry.route, entry]));

  for (const route of REQUIRED_ROUTES) {
    const entry = coverageByRoute.get(route);
    if (!entry) {
      blockers.push(`route coverage is missing ${route}.`);
      continue;
    }

    if (!isPass(entry.status)) {
      blockers.push(`route coverage ${route} did not pass.`);
    }

    pushMissingText(blockers, `route coverage ${route} authMode`, entry.authMode);
    pushInvalidEvidenceUrl(blockers, evidence, `route coverage ${route} evidenceUrl`, entry.evidenceUrl);
  }
}

function validateAccessibility(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const accessibility = evidence.accessibility;

  if (!accessibility) {
    blockers.push('accessibility evidence is required.');
    return;
  }

  if (!isPass(accessibility.status)) {
    blockers.push('accessibility evidence did not pass.');
  }

  if (!accessibility.keyboard) {
    blockers.push('accessibility evidence is missing keyboard coverage.');
  }

  if (!accessibility.namedControls) {
    blockers.push('accessibility evidence is missing named-control coverage.');
  }

  if (!accessibility.desktop) {
    blockers.push('accessibility evidence is missing desktop coverage.');
  }

  if (!accessibility.mobile) {
    blockers.push('accessibility evidence is missing mobile coverage.');
  }

  pushInvalidEvidenceUrl(blockers, evidence, 'accessibility evidenceUrl', accessibility.evidenceUrl);
}

function validateWorkflows(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const workflowsById = new Map(evidence.workflows.map((workflow) => [normalize(workflow.id), workflow]));

  for (const workflowId of REQUIRED_WORKFLOWS) {
    const workflow = workflowsById.get(workflowId);
    if (!workflow) {
      blockers.push(`workflow matrix is missing ${workflowId}.`);
      continue;
    }

    if (!isPass(workflow.status)) {
      blockers.push(`workflow ${workflowId} did not pass.`);
    }

    if (!workflow.desktop) {
      blockers.push(`workflow ${workflowId} is missing desktop evidence.`);
    }

    if (!workflow.mobile) {
      blockers.push(`workflow ${workflowId} is missing mobile evidence.`);
    }

    pushMissingText(blockers, `workflow ${workflowId} accountRole`, workflow.accountRole);
    pushInvalidEvidenceUrl(
      blockers,
      evidence,
      `workflow ${workflowId} evidenceUrl`,
      workflow.evidenceUrl
    );
  }
}

function validatePerformance(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const performance = evidence.performance;

  if (!performance) {
    blockers.push('performance evidence is required.');
    return;
  }

  if (!isStagingLike(performance.environment)) {
    blockers.push('performance evidence must come from staging or preview.');
  }

  if (!isPass(performance.status)) {
    blockers.push('performance evidence did not pass.');
  }

  for (const metric of REQUIRED_PERFORMANCE_METRICS) {
    if (typeof performance.metrics?.[metric] !== 'number') {
      blockers.push(`performance metrics are missing ${metric}.`);
    }
  }

  pushInvalidEvidenceUrl(blockers, evidence, 'performance evidenceUrl', performance.evidenceUrl);
}

function validateDegradedStates(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  if (evidence.degradedStates.length === 0) {
    blockers.push('at least one staging degraded-state evidence item is required.');
  }

  for (const item of evidence.degradedStates) {
    if (!isStagingLike(item.environment)) {
      blockers.push(`degraded-state evidence ${item.id} must come from staging or preview.`);
    }

    if (!isPass(item.status)) {
      blockers.push(`degraded-state evidence ${item.id} did not pass.`);
    }

    pushInvalidEvidenceUrl(
      blockers,
      evidence,
      `degraded-state evidence ${item.id} evidenceUrl`,
      item.evidenceUrl
    );
  }
}

function validateAcceptedRisks(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  for (const risk of evidence.acceptedRisks) {
    if (risk.status !== 'accepted') continue;

    if (!hasText(risk.owner)) blockers.push(`accepted risk ${risk.id} is missing owner.`);
    if (!hasText(risk.reason)) blockers.push(`accepted risk ${risk.id} is missing reason.`);
    if (!hasText(risk.mitigation)) blockers.push(`accepted risk ${risk.id} is missing mitigation.`);
    if (!hasText(risk.expiry)) blockers.push(`accepted risk ${risk.id} is missing expiry.`);
    if (!hasText(risk.rollbackSignal)) {
      blockers.push(`accepted risk ${risk.id} is missing rollbackSignal.`);
    }
  }
}

function validateLaunchBlockers(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  for (const blocker of evidence.launchBlockers) {
    if (blocker.status === 'open') {
      blockers.push(`launch blocker ${blocker.id} remains open.`);
      continue;
    }

    if (blocker.status === 'closed') {
      pushInvalidEvidenceUrl(
        blockers,
        evidence,
        `launch blocker ${blocker.id} retestEvidenceUrl`,
        blocker.retestEvidenceUrl
      );
    }
  }
}

function validateFinalRecommendation(evidence: GoLiveEvidenceDocument, blockers: string[]) {
  const recommendation = evidence.finalRecommendation;

  if (!recommendation) {
    blockers.push('finalRecommendation is required.');
    return;
  }

  if (!['go', 'no-go', 'go-with-accepted-risks'].includes(recommendation.decision)) {
    blockers.push('finalRecommendation decision must be go, no-go, or go-with-accepted-risks.');
  }

  pushMissingText(blockers, 'finalRecommendation rationale', recommendation.rationale);
  pushMissingText(blockers, 'finalRecommendation rollbackPlan', recommendation.rollbackPlan);
  pushMissingText(
    blockers,
    'finalRecommendation postDeploySmokePlan',
    recommendation.postDeploySmokePlan
  );
}

export function validateGoLiveEvidence(evidence: GoLiveEvidenceDocument): GoLiveEvidenceResult {
  const blockers: string[] = [];

  pushMissingText(blockers, 'releaseId', evidence.releaseId);
  pushMissingText(blockers, 'commitSha', evidence.commitSha);
  pushMissingText(blockers, 'testDate', evidence.testDate);
  pushMissingText(blockers, 'tester', evidence.tester);
  pushMissingText(blockers, 'environment', evidence.environment);
  pushMissingText(blockers, 'baseUrl', evidence.baseUrl);

  if (hasText(evidence.environment) && !isStagingLike(evidence.environment)) {
    blockers.push('release evidence environment must be staging or preview.');
  }

  validateFixtureEvidence(evidence, blockers);
  validateCommandEvidence(evidence, blockers);
  validateRouteCoverage(evidence, blockers);
  validateAccessibility(evidence, blockers);
  validateBrowserRuns(evidence, blockers);
  validateWorkflows(evidence, blockers);
  validatePerformance(evidence, blockers);
  validateDegradedStates(evidence, blockers);
  validateAcceptedRisks(evidence, blockers);
  validateLaunchBlockers(evidence, blockers);
  validateFinalRecommendation(evidence, blockers);

  return {
    ok: blockers.length === 0,
    blockers,
    summary: {
      releaseId: hasText(evidence.releaseId) ? evidence.releaseId : null,
      commitSha: hasText(evidence.commitSha) ? evidence.commitSha : null,
      environment: hasText(evidence.environment) ? evidence.environment : null,
      commandEvidence: evidence.commandEvidence?.length ?? 0,
      routeCoverage: evidence.routeCoverage?.length ?? 0,
      browserRuns: evidence.browserRuns.length,
      workflows: evidence.workflows.length,
      degradedStates: evidence.degradedStates.length,
      acceptedRisks: evidence.acceptedRisks.length,
      launchBlockers: evidence.launchBlockers.length,
      finalDecision: evidence.finalRecommendation?.decision ?? null,
    },
  };
}

function readEvidenceFile(filePath: string): GoLiveEvidenceDocument {
  return JSON.parse(readFileSync(filePath, 'utf8')) as GoLiveEvidenceDocument;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseEvidenceArgs(argv);

  if (args.init) {
    const scaffold = buildEvidenceScaffold(parseEvidenceInitConfig(argv));
    const output = `${JSON.stringify(scaffold, null, 2)}\n`;

    if (args.outputPath) {
      writeFileSync(args.outputPath, output, 'utf8');
    } else {
      process.stdout.write(output);
    }

    return;
  }

  if (!args.filePath) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          blockers: ['Usage: npm run go-live:evidence-check -- --file <evidence.json>'],
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const result = validateGoLiveEvidence(readEvidenceFile(args.filePath));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          blockers: [error instanceof Error ? error.message : String(error)],
        },
        null,
        2
      )
    );
    process.exit(1);
  });
}
