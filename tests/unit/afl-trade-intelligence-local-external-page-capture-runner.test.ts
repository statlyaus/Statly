import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  parseLocalExternalCaptureArguments,
  requireDurableArtifactRoot,
} from '../../Scripts/capture-local-external-pages';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from '@/server/aflTradeIntelligence/development/localDraftguruTradeAuthorityProposal';
import {
  createLocalDraftguruTradeCaptureTargets,
  loadRecordedLocalCaptureAuthority,
} from '@/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import type { LocalNarrowCaptureAuthority } from '@/server/aflTradeIntelligence/development/localNarrowCaptureAuthority';
import {
  createLocalOfficialAflDraftSessionTargets,
  createOfficialAflDraftSessionCaptureCommand,
} from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0AAgainstDecision } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';
import {
  approveNarrowAuthority,
  officialAflDraftSessionAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';

const digest = (character: string) => character.repeat(64);
const evaluatedAt = '2026-09-25T00:00:00.000Z';

function recorded(capabilityId: DraftguruTradeCapability) {
  const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal({
    capabilityId,
    seasons: Array.from({ length: 15 }, (_, index) => 2011 + index),
    evidenceIds: {
      productOwnerAuthorization: `artifact:${digest('1')}`,
      boundedCapturePlan: `artifact:${digest('2')}`,
      publicAccessReview: `artifact:${digest('3')}`,
      fieldBoundaryReview: `artifact:${digest('4')}`,
    },
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-09-24T00:00:00.000Z',
      proposalProposedAt: '2026-09-24T00:00:01.000Z',
    },
  });
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'non_production' as const,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-product-owner',
    decidedBy: 'statly-product-owner',
    reviewers: [] as never[],
    authorityEvidenceIds: [`artifact:${digest('1')}`],
    conditionResults: sourceRights.content.conditions.map((condition) => ({
      conditionId: condition.conditionId,
      status: 'satisfied' as const,
      evidenceIds: condition.verificationEvidenceIds,
      explanation: 'Test approval.',
    })),
    rationale: 'Test approval of the exact narrow proposal.',
    limitations: [...proposal.content.scope.exclusions],
    decidedAt: '2026-09-24T01:00:00.000Z',
    effectiveAt: '2026-09-24T01:00:00.000Z',
    revalidateAt: '2027-09-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [] as string[],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
  return { sourceRights, proposal, decision };
}

type RecordedAuthority = LocalNarrowCaptureAuthority & {
  decision: ReturnType<typeof aflTradeGateDecisionRecordSchema.parse>;
};

function ledgerOf(
  record: RecordedAuthority,
  sourceRights: LocalNarrowCaptureAuthority['sourceRights'] = record.sourceRights
) {
  const ledger = { proposals: [record.proposal], decisions: [record.decision] };
  return {
    load: async () => ({ revision: 1, ledger }),
    resolveAuthorization: async () => ({ revision: 1, ledger, sourceRights }),
  };
}

describe('recorded Draftguru trade authority', () => {
  it.each(['draftguru-trade-index', 'draftguru-trade-detail'] as const)(
    'loads the owner decision, proposal and rights for %s',
    async (capabilityId) => {
      const record = recorded(capabilityId);
      const loaded = await loadRecordedLocalCaptureAuthority(
        ledgerOf(record),
        capabilityId,
        2020,
        evaluatedAt
      );
      expect(loaded.decisionId).toBe(record.decision.decisionId);
      expect(loaded.authority.sourceRights.rightsArtifactId).toBe(
        record.sourceRights.rightsArtifactId
      );
      expect(loaded.authority.proposal.proposalId).toBe(record.proposal.proposalId);
      // The bounded capture plan is the reviewed egress control for the five-second pacing.
      expect(loaded.egressPolicyEvidenceId).toBe(`artifact:${digest('2')}`);
    }
  );

  it('fails closed when the ledger has no decision for the requested capability', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recorded('draftguru-trade-index')),
        'draftguru-trade-detail',
        2020,
        evaluatedAt
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
  });

  it('fails closed before the decision is effective', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recorded('draftguru-trade-detail')),
        'draftguru-trade-detail',
        2020,
        '2026-09-23T00:00:00.000Z'
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
  });

  it('refuses recorded rights whose pacing differs from what the runner enforces', async () => {
    const record = recorded('draftguru-trade-detail');
    const faster = {
      ...record.sourceRights,
      content: {
        ...record.sourceRights.content,
        automatedAccess: {
          ...record.sourceRights.content.automatedAccess,
          rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
        },
      },
    };
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(record, faster),
        'draftguru-trade-detail',
        2020,
        evaluatedAt
      )
    ).rejects.toThrow(/pacing/);
  });
});

const officialEvidenceIds = {
  productOwnerAuthorization: `artifact:${digest('5')}`,
  boundedCapturePlan: `artifact:${digest('6')}`,
  publicAccessReview: `artifact:${digest('7')}`,
  fieldBoundaryReview: `artifact:${digest('8')}`,
};

function recordedOfficial(season: number, clientVersion?: string): RecordedAuthority {
  const authority = officialAflDraftSessionAuthority({
    season,
    ...(clientVersion === undefined ? {} : { clientVersion }),
    evidenceIds: officialEvidenceIds,
    timing: {
      termsEffectiveAt: '2026-09-10T00:00:00.000Z',
      termsExpireAt: '2027-09-09T00:00:00.000Z',
      rightsProposedAt: '2026-09-24T00:00:00.000Z',
      proposalProposedAt: '2026-09-24T00:00:01.000Z',
    },
  });
  return {
    ...authority,
    decision: approveNarrowAuthority(authority, {
      decidedAt: '2026-09-24T01:00:00.000Z',
      revalidateAt: '2027-09-01T00:00:00.000Z',
    }),
  };
}

describe('recorded Official AFL completed-session authority', () => {
  it('loads the per-season decision recorded under the issue579 parser-version key', async () => {
    const record = recordedOfficial(2020);
    expect(record.proposal.content.decisionKey).toBe(
      'official-afl-completed-draft-session-issue579-private-2020-session-v18'
    );
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'official-afl-completed-draft-session',
      2020,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
    expect(loaded.egressPolicyEvidenceId).toBe(`artifact:${digest('6')}`);
  });

  it('fails closed when only another season is recorded', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedOfficial(2020)),
        'official-afl-completed-draft-session',
        2021,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-completed-draft-session-issue579-private-2021-session-v18/);
  });

  it('refuses a recorded decision for an earlier parser version', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedOfficial(2020, 'official-afl-completed-draft-session/v5')),
        'official-afl-completed-draft-session',
        2020,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-completed-draft-session\/v18/);
  });

  it('refuses recorded rights with the Draftguru one-day cache instead of the reviewed hour', async () => {
    const record = recordedOfficial(2020);
    const longer = {
      ...record.sourceRights,
      content: {
        ...record.sourceRights.content,
        automatedAccess: {
          ...record.sourceRights.content.automatedAccess,
          cache: { permitted: true, maximumSeconds: 86_400 },
        },
      },
    };
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(record, longer),
        'official-afl-completed-draft-session',
        2020,
        evaluatedAt
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
  });

  it('builds a capture command that the scope rules and the recorded decision admit', () => {
    const record = recordedOfficial(2021);
    for (const target of createLocalOfficialAflDraftSessionTargets([2021])) {
      const command = createOfficialAflDraftSessionCaptureCommand(record, {
        target,
        capturedAt: evaluatedAt,
        maximumBytes: 1024,
      });
      expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
      expect(command.request).toMatchObject({
        provider: 'official_afl',
        draftPathway: 'national',
        parserVersion: 'official-afl-completed-draft-session/v18',
      });
      expect(
        evaluateAflTradeGate0AAgainstDecision(
          record.decision,
          record.sourceRights,
          command.gateRequest
        )
      ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    }
  });
});

describe('local Official AFL completed-session targets', () => {
  it('enumerates every reviewed completed-session page for 2019, 2020 and 2021', () => {
    expect(createLocalOfficialAflDraftSessionTargets([2021, 2019, 2020])).toEqual([
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2019,
        sourceUrl:
          'https://www.afl.com.au/news/149305/who-smashed-it-our-say-on-your-clubs-draft-performance',
        effectiveAt: '2019-11-28T00:00:00.000Z',
      },
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2020,
        sourceUrl:
          'https://www.afl.com.au/news/528411/every-pick-every-player-check-out-who-your-club-drafted',
        effectiveAt: '2020-12-09T00:00:00.000Z',
      },
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2021,
        sourceUrl:
          'https://www.afl.com.au/news/688959/the-horne-supremacy-north-melbourne-makes-jason-horne-francis-its-no1-pick-for-the-2021-nab-afl-draft',
        effectiveAt: '2021-11-24T00:00:00.000Z',
      },
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2021,
        sourceUrl:
          'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait',
        effectiveAt: '2021-11-25T00:00:00.000Z',
      },
    ]);
  });

  it.each([[[]], [[2020, 2020]], [[2015]], [[2031]]])('rejects seasons %j', (seasons) => {
    expect(() => createLocalOfficialAflDraftSessionTargets(seasons)).toThrow();
  });
});

describe('local Draftguru capture targets', () => {
  it('derives each trade page season from its exact URL', () => {
    expect(
      createLocalDraftguruTradeCaptureTargets({
        capabilityId: 'draftguru-trade-detail',
        urls: ['https://www.draftguru.com.au/trades/2020-jeremy-cameron'],
      })
    ).toEqual([
      {
        capabilityId: 'draftguru-trade-detail',
        season: 2020,
        sourceUrl: 'https://www.draftguru.com.au/trades/2020-jeremy-cameron',
      },
    ]);
  });

  it('bounds the index to the requested seasons', () => {
    expect(
      createLocalDraftguruTradeCaptureTargets({
        capabilityId: 'draftguru-trade-index',
        season: 2020,
      })
    ).toEqual([
      {
        capabilityId: 'draftguru-trade-index',
        season: 2020,
        discoveryFromSeason: 2020,
        sourceUrl: 'https://www.draftguru.com.au/trades',
      },
    ]);
  });

  it.each([
    [['https://www.draftguru.com.au/years/2020']],
    [['not a url']],
    [[]],
    [
      [
        'https://www.draftguru.com.au/trades/2020-jeremy-cameron',
        'https://www.draftguru.com.au/trades/2020-jeremy-cameron',
      ],
    ],
  ])('rejects detail targets %j', (urls) => {
    expect(() =>
      createLocalDraftguruTradeCaptureTargets({ capabilityId: 'draftguru-trade-detail', urls })
    ).toThrow();
  });
});

describe('local Draftguru capture command arguments', () => {
  let durable: string;
  beforeAll(async () => {
    durable = await mkdtemp(join(tmpdir(), 'statly-durable-root-'));
  });
  afterAll(async () => {
    await rm(durable, { recursive: true });
  });

  const env = {
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55432/statly_outcomes',
    AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly private evaluation (contact: owner@example.com)',
  };
  // The unit test's scratch root stands in for a durable directory by clearing the temporary list.
  const parse = (argv: string[], changes: Record<string, string> = {}) =>
    parseLocalExternalCaptureArguments(argv, { ...env, ...changes }, []);

  it('parses a single named trade page', () => {
    const parsed = parse([
      '--artifact-root',
      durable,
      '--capability',
      'draftguru-trade-detail',
      '--url',
      'https://www.draftguru.com.au/trades/2020-jeremy-cameron',
    ]);
    expect(parsed.targets).toEqual([
      {
        capabilityId: 'draftguru-trade-detail',
        season: 2020,
        sourceUrl: 'https://www.draftguru.com.au/trades/2020-jeremy-cameron',
      },
    ]);
  });

  it('parses a season-bounded index capture', () => {
    const parsed = parse([
      '--artifact-root',
      durable,
      '--capability',
      'draftguru-trade-index',
      '--season',
      '2020',
      '--from-season',
      '2011',
    ]);
    expect(parsed.targets[0]).toMatchObject({ season: 2020, discoveryFromSeason: 2011 });
  });

  it('parses completed-session seasons into their reviewed pages', () => {
    const parsed = parse([
      '--artifact-root',
      durable,
      '--capability',
      'official-afl-completed-draft-session',
      '--season',
      '2019',
      '--season',
      '2020',
      '--season',
      '2021',
    ]);
    expect(parsed.targets.map(({ season }) => season)).toEqual([2019, 2020, 2021, 2021]);
  });

  it('requires an artifact root', () => {
    expect(() => parse(['--capability', 'draftguru-trade-index', '--season', '2020'])).toThrow(
      /--artifact-root is required/
    );
  });

  it.each([
    [['--artifact-root', 'relative', '--capability', 'draftguru-trade-index', '--season', '2020']],
    [['--artifact-root', '/definitely/missing', '--capability', 'draftguru-trade-index']],
    [['--capability', 'draftguru-year-page', '--season', '2020']],
    [['--capability', 'draftguru-trade-index', '--url', 'https://www.draftguru.com.au/trades']],
    [['--capability', 'draftguru-trade-detail', '--season', '2020']],
    [['--capability', 'draftguru-trade-index', '--season', '20']],
    [['--capability', 'official-afl-completed-draft-session']],
    [['--capability', 'official-afl-completed-draft-session', '--url', 'https://www.afl.com.au/']],
    [
      [
        '--capability',
        'official-afl-completed-draft-session',
        '--season',
        '2020',
        '--from-season',
        '2019',
      ],
    ],
    [['--unknown', 'value']],
  ])('rejects %j', (argv) => {
    const withRoot = argv.includes('--artifact-root')
      ? argv
      : ['--artifact-root', durable, ...argv];
    expect(() => parse(withRoot)).toThrow(TypeError);
  });

  it('refuses a remote database and an anonymous user agent', () => {
    const argv = ['--artifact-root', durable, '--capability', 'draftguru-trade-index'];
    expect(() =>
      parse([...argv, '--season', '2020'], {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://postgres@db.example.com:5432/statly',
      })
    ).toThrow(/loopback/);
    expect(() =>
      parse([...argv, '--season', '2020'], { AFL_TRADE_EXTERNAL_USER_AGENT: 'curl/8' })
    ).toThrow(/contact/);
  });

  it('refuses temporary artifact roots', () => {
    expect(() => requireDurableArtifactRoot(durable)).toThrow(/durable/);
    expect(() => requireDurableArtifactRoot(durable, [])).not.toThrow();
  });
});
