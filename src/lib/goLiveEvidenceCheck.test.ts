import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  buildEvidenceScaffold,
  parseEvidenceInitConfig,
  parseEvidenceArgs,
  validateGoLiveEvidence,
  type GoLiveEvidenceDocument,
} from '../../Scripts/go-live-evidence-check';

const requiredBrowsers = ['chrome', 'safari', 'firefox', 'mobile-safari', 'chrome-android'];
const requiredWorkflows = [
  'auth-session',
  'dashboard',
  'league-switch',
  'draft-room',
  'trade-review',
  'waiver-flow',
  'player-rankings',
  'admin-denial',
];
const requiredCommands = [
  'npm run typecheck',
  'npm run lint',
  'npm run guard:routes',
  'npm run guard:design',
  'npm test',
  'npm run branch:complete',
];
const requiredRoutes = [
  '/',
  '/login',
  '/dashboard',
  '/players',
  '/rankings',
  '/leagues/:leagueId',
  '/drafts/:draftId',
  '/admin/workers',
];

function buildValidEvidence(overrides: Partial<GoLiveEvidenceDocument> = {}): GoLiveEvidenceDocument {
  return {
    releaseId: 'release-2026-05-21',
    commitSha: 'abc123def456',
    testDate: '2026-05-21',
    tester: 'Go Live QA',
    environment: 'staging',
    baseUrl: 'https://staging.statly.test',
    fixture: {
      datasetVersion: 'go-live-fixtures-2026-05-21',
      smokeAccountEmail: 'smoke@statly.test',
      leagueId: 'league_123',
      draftId: 'draft_123',
    },
    commandEvidence: requiredCommands.map((command) => ({
      command,
      status: 'pass',
      evidenceUrl: `https://evidence.statly.test/commands/${command.replaceAll(' ', '-')}`,
    })),
    routeCoverage: requiredRoutes.map((route) => ({
      route,
      status: 'pass',
      authMode: route === '/admin/workers' ? 'standard-user-denied' : 'smoke-user',
      evidenceUrl: `https://evidence.statly.test/routes/${route.replaceAll('/', '-')}`,
    })),
    accessibility: {
      status: 'pass',
      keyboard: true,
      namedControls: true,
      desktop: true,
      mobile: true,
      evidenceUrl: 'https://evidence.statly.test/accessibility',
    },
    browserRuns: requiredBrowsers.map((browser) => ({
      browser,
      platform: browser.includes('mobile') || browser === 'chrome-android' ? 'mobile' : 'desktop',
      viewport: browser.includes('mobile') || browser === 'chrome-android' ? '390x844' : '1440x900',
      status: 'pass',
      consoleErrors: 0,
      failedNetworkRequests: 0,
      evidenceUrl: `https://evidence.statly.test/${browser}`,
    })),
    workflows: requiredWorkflows.map((workflow) => ({
      id: workflow,
      status: 'pass',
      desktop: true,
      mobile: true,
      accountRole: workflow === 'admin-denial' ? 'standard-user' : 'smoke-user',
      evidenceUrl: `https://evidence.statly.test/${workflow}`,
    })),
    performance: {
      environment: 'staging',
      source: 'web-vitals',
      status: 'pass',
      metrics: {
        CLS: 0.01,
        FCP: 1200,
        INP: 100,
        LCP: 1800,
        TTFB: 200,
      },
      evidenceUrl: 'https://evidence.statly.test/performance',
    },
    degradedStates: [
      {
        id: 'dashboard-api-failure',
        environment: 'staging',
        status: 'pass',
        evidenceUrl: 'https://evidence.statly.test/degraded-dashboard',
      },
    ],
    acceptedRisks: [],
    launchBlockers: [],
    finalRecommendation: {
      decision: 'go',
      rationale: 'All required evidence passed for the release candidate.',
      rollbackPlan: 'Rollback to the previous stable deployment if P0 errors recur.',
      postDeploySmokePlan: 'Run public, auth, dashboard, league, roster, rankings, and logout smoke.',
    },
    ...overrides,
  };
}

describe('go-live evidence check', () => {
  it('accepts complete staging release evidence', () => {
    const result = validateGoLiveEvidence(buildValidEvidence());

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('fails when browser matrix and workflow evidence are incomplete', () => {
    const evidence = buildValidEvidence({
      browserRuns: [
        {
          browser: 'chrome',
          platform: 'desktop',
          viewport: '1440x900',
          status: 'pass',
          consoleErrors: 0,
          failedNetworkRequests: 0,
        },
      ],
      workflows: [
        {
          id: 'auth-session',
          status: 'pass',
          desktop: true,
          mobile: false,
          accountRole: 'smoke-user',
        },
      ],
    });

    const result = validateGoLiveEvidence(evidence);

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/browser matrix is missing safari/),
        expect.stringMatching(/workflow auth-session is missing mobile evidence/),
        expect.stringMatching(/workflow matrix is missing dashboard/),
      ])
    );
  });

  it('rejects local-only performance and degraded-state evidence', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        performance: {
          environment: 'local',
          source: 'devtools',
          status: 'pass',
          metrics: {
            FCP: 1000,
            LCP: 1500,
          },
        },
        degradedStates: [
          {
            id: 'dashboard-api-failure',
            environment: 'local',
            status: 'pass',
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/performance evidence must come from staging/),
        expect.stringMatching(/performance metrics are missing CLS/),
        expect.stringMatching(/degraded-state evidence dashboard-api-failure must come from staging/),
      ])
    );
  });

  it('requires accepted risks and launch blockers to be actionable', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        acceptedRisks: [
          {
            id: 'risk-1',
            status: 'accepted',
            owner: 'Engineering',
            reason: 'Known external lab delay',
          },
        ],
        launchBlockers: [
          {
            id: 'blocker-1',
            severity: 'P0',
            status: 'open',
            description: 'Staging auth unavailable',
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/accepted risk risk-1 is missing mitigation/),
        expect.stringMatching(/accepted risk risk-1 is missing expiry/),
        expect.stringMatching(/launch blocker blocker-1 remains open/),
      ])
    );
  });

  it('rejects placeholder evidence URLs for non-example releases', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        releaseId: 'release-2026-05-21',
        browserRuns: requiredBrowsers.map((browser) => ({
          browser,
          platform:
            browser.includes('mobile') || browser === 'chrome-android' ? 'mobile' : 'desktop',
          viewport:
            browser.includes('mobile') || browser === 'chrome-android' ? '390x844' : '1440x900',
          status: 'pass',
          consoleErrors: 0,
          failedNetworkRequests: 0,
          evidenceUrl: `replace-with-evidence-url/release-2026-05-21/${browser}`,
        })),
        workflows: requiredWorkflows.map((workflow) => ({
          id: workflow,
          status: 'pass',
          desktop: true,
          mobile: true,
          accountRole: workflow === 'admin-denial' ? 'standard-user' : 'smoke-user',
          evidenceUrl: `https://evidence.statly.example/release-2026-05-21/${workflow}`,
        })),
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/browser chrome evidenceUrl must be a real evidence URL/),
        expect.stringMatching(/workflow auth-session evidenceUrl must be a real evidence URL/),
      ])
    );
  });

  it('requires all release command evidence to pass', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        commandEvidence: [
          {
            command: 'npm run typecheck',
            status: 'pass',
            evidenceUrl: 'https://evidence.statly.test/commands/typecheck',
          },
          {
            command: 'npm run lint',
            status: 'fail',
            evidenceUrl: 'https://evidence.statly.test/commands/lint',
          },
        ],
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/command evidence npm run lint did not pass/),
        expect.stringMatching(/command evidence is missing npm run guard:routes/),
        expect.stringMatching(/command evidence is missing npm test/),
      ])
    );
  });

  it('requires final launch recommendation, rollback plan, and post-deploy smoke plan', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        finalRecommendation: {
          decision: 'go',
          rationale: '',
          rollbackPlan: '',
          postDeploySmokePlan: '',
        },
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/finalRecommendation rationale is required/),
        expect.stringMatching(/finalRecommendation rollbackPlan is required/),
        expect.stringMatching(/finalRecommendation postDeploySmokePlan is required/),
      ])
    );
  });

  it('requires release metadata, fixture, route coverage, and accessibility evidence', () => {
    const result = validateGoLiveEvidence(
      buildValidEvidence({
        commitSha: '',
        testDate: '',
        tester: '',
        fixture: {
          datasetVersion: '',
          smokeAccountEmail: '',
          leagueId: '',
          draftId: '',
        },
        routeCoverage: [
          {
            route: '/',
            status: 'pass',
            authMode: 'anonymous',
            evidenceUrl: 'https://evidence.statly.test/routes/home',
          },
          {
            route: '/login',
            status: 'fail',
            authMode: 'anonymous',
            evidenceUrl: 'https://evidence.statly.test/routes/login',
          },
        ],
        accessibility: {
          status: 'fail',
          keyboard: false,
          namedControls: false,
          desktop: true,
          mobile: false,
          evidenceUrl: 'https://evidence.statly.test/accessibility',
        },
      })
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/commitSha is required/),
        expect.stringMatching(/fixture datasetVersion is required/),
        expect.stringMatching(/route coverage \/login did not pass/),
        expect.stringMatching(/route coverage is missing \/dashboard/),
        expect.stringMatching(/accessibility evidence did not pass/),
        expect.stringMatching(/accessibility evidence is missing keyboard coverage/),
      ])
    );
  });

  it('parses the evidence file argument', () => {
    expect(parseEvidenceArgs(['--file', 'tmp/evidence.json'])).toEqual({
      filePath: 'tmp/evidence.json',
      init: false,
      outputPath: undefined,
    });
    expect(parseEvidenceArgs(['--file=tmp/evidence.json'])).toEqual({
      filePath: 'tmp/evidence.json',
      init: false,
      outputPath: undefined,
    });
  });

  it('builds a release-specific evidence scaffold from flags and env aliases', () => {
    const config = parseEvidenceInitConfig(
      [
        '--release-id',
        'release-123',
        '--base-url',
        'https://staging.statly.test',
        '--smoke-account',
        'smoke@statly.test',
      ],
      {
        GO_LIVE_SMOKE_LEAGUE_ID: 'league_123',
        GO_LIVE_SMOKE_DRAFT_ID: 'draft_123',
        GO_LIVE_BUILD_ID: 'build_123',
      }
    );

    const scaffold = buildEvidenceScaffold(config);

    expect(scaffold.releaseId).toBe('release-123');
    expect(scaffold.baseUrl).toBe('https://staging.statly.test');
    expect(scaffold.fixture).toMatchObject({
      smokeAccountEmail: 'smoke@statly.test',
      leagueId: 'league_123',
      draftId: 'draft_123',
    });
    expect(scaffold.routeCoverage).toHaveLength(8);
    expect(scaffold.accessibility).toMatchObject({
      status: 'not-run',
      keyboard: false,
      namedControls: false,
      desktop: false,
      mobile: false,
    });
    expect(scaffold.browserRuns).toHaveLength(5);
    expect(scaffold.commandEvidence).toHaveLength(6);
    expect(scaffold.commandEvidence.every((command) => command.status === 'not-run')).toBe(true);
    expect(scaffold.finalRecommendation).toMatchObject({
      decision: 'no-go',
      rationale: '',
      rollbackPlan: '',
      postDeploySmokePlan: '',
    });
    expect(scaffold.workflows).toHaveLength(8);
    expect(scaffold.browserRuns.every((run) => run.status === 'not-run')).toBe(true);
    expect(scaffold.workflows.every((workflow) => workflow.status === 'not-run')).toBe(true);
    expect(scaffold.degradedStates[0]).toMatchObject({
      id: 'dashboard-api-failure',
      environment: 'staging',
      status: 'not-run',
    });
    expect(validateGoLiveEvidence(scaffold).ok).toBe(false);
  });

  it('keeps the checked-in example aligned with the validator contract', () => {
    const evidence = JSON.parse(
      readFileSync('docs/go-live-evidence.example.json', 'utf8')
    ) as GoLiveEvidenceDocument;

    const result = validateGoLiveEvidence(evidence);

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});
