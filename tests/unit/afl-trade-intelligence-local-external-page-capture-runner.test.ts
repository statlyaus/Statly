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
import {
  createDraftguruNationalYearCaptureCommand,
  createLocalDraftguruNationalYearTargets,
} from '@/server/aflTradeIntelligence/development/localDraftguruNationalYearCapture';
import {
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from '@/server/aflTradeIntelligence/development/localNarrowCaptureAuthority';
import {
  createLocalOfficialAflDraftSessionTargets,
  createOfficialAflDraftSessionCaptureCommand,
} from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import {
  createLocalOfficialAflDraftOrderTargets,
  createOfficialAflDraftOrderCaptureCommand,
} from '@/server/aflTradeIntelligence/development/localOfficialAflDraftOrderCapture';
import {
  createFootyinfoDraftBoardCaptureCommand,
  createLocalFootyinfoDraftBoardTargets,
} from '@/server/aflTradeIntelligence/development/localFootyinfoDraftBoardCapture';
import { parseFootyinfoDraftBoard } from '@/server/aflTradeIntelligence/source/footyinfoDraftBoardAdapter';
import { footyinfoBoardPage, SYNTHETIC_BOARD_PICKS } from '../testUtils/footyinfoDraftBoardPage';
import { parseOfficialAflDraftOrderTable } from '@/server/aflTradeIntelligence/source/draftCorroborationAdapter';
import { requireAflTradeExternalEvidenceFieldAuthority } from '@/server/aflTradeIntelligence/source/externalDraftTradeFieldManifest';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0AAgainstDecision } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';
import {
  approveNarrowAuthority,
  draftguruNationalYearAuthority,
  officialAflDraftOrderAuthority,
  footyinfoDraftBoardAuthority,
  officialAflDraftSessionAuthority,
} from '../testUtils/localNarrowCaptureAuthorityFixture';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';

const digest = (character: string) => character.repeat(64);
const evaluatedAt = '2026-09-25T00:00:00.000Z';

function recorded(capabilityId: DraftguruTradeCapability) {
  const { sourceRights, proposal } = createDraftguruTradeAuthorityProposal({
    capabilityId,
    // The runner captures trade detail with v3 under its own decision.
    ...(capabilityId === 'draftguru-trade-detail'
      ? { parserVersion: DRAFTGURU_TRADE_EVENTUAL_SELECTION_PARSER_VERSION }
      : {}),
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
      'official-afl-completed-draft-session-issue579-private-2020-session-v19'
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
    ).rejects.toThrow(/official-afl-completed-draft-session-issue579-private-2021-session-v19/);
  });

  it('refuses a recorded decision for an earlier parser version', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedOfficial(2020, 'official-afl-completed-draft-session/v18')),
        'official-afl-completed-draft-session',
        2020,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-completed-draft-session\/v19/);
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
        parserVersion: 'official-afl-completed-draft-session/v19',
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

function recordedNational(season: number, clientVersion?: string): RecordedAuthority {
  const authority = draftguruNationalYearAuthority({
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

describe('recorded Draftguru national-year authority', () => {
  it.each([
    [2011, 'v4'],
    [2013, 'v4'],
    [2016, 'v4'],
    [2000, 'v6'],
    [2008, 'v6'],
    [2010, 'v6'],
  ])(
    'loads %s from its parser-%s decision and builds a capture request at that parser',
    async (season, parser) => {
      const record = recordedNational(season);
      expect(record.proposal.content.decisionKey).toBe(
        `draftguru-national-year-page-issue579-private-${season}-parser-${parser}`
      );
      const loaded = await loadRecordedLocalCaptureAuthority(
        ledgerOf(record),
        'draftguru-national-year-page',
        season,
        evaluatedAt
      );
      expect(loaded.decisionId).toBe(record.decision.decisionId);
      const [target] = createLocalDraftguruNationalYearTargets([season]);
      const command = createDraftguruNationalYearCaptureCommand(record, {
        target: target!,
        capturedAt: evaluatedAt,
        maximumBytes: 1024,
      });
      expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
      expect(command.request.parserVersion).toBe(`draftguru-national-year-page/${parser}`);
      expect(
        evaluateAflTradeGate0AAgainstDecision(
          record.decision,
          record.sourceRights,
          command.gateRequest
        )
      ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    }
  );

  it.each([2015, 2008])(
    'never falls back from a %s page to its parser-v3 decision',
    async (season) => {
      const record = recordedNational(season, 'draftguru-national-year-page/v3');
      await expect(
        loadRecordedLocalCaptureAuthority(
          ledgerOf(record),
          'draftguru-national-year-page',
          season,
          evaluatedAt
        )
      ).rejects.toThrow();
    }
  );

  it('loads the per-season decision recorded under the issue579 key', async () => {
    const record = recordedNational(2024);
    expect(record.proposal.content.decisionKey).toBe(
      'draftguru-national-year-page-issue579-private-2024-parser-v3'
    );
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'draftguru-national-year-page',
      2024,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
  });

  it('fails closed when only another season is recorded', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedNational(2024)),
        'draftguru-national-year-page',
        2023,
        evaluatedAt
      )
    ).rejects.toThrow(/draftguru-national-year-page-issue579-private-2023/);
  });

  it('refuses rights that name the general year-page parser', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedNational(2024, 'draftguru-event-year/v2')),
        'draftguru-national-year-page',
        2024,
        evaluatedAt
      )
    ).rejects.toThrow(/draftguru-national-year-page\/v3/);
  });

  it('refuses a recorded v2 decision for new captures under v3', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedNational(2019, 'draftguru-national-year-page/v2')),
        'draftguru-national-year-page',
        2019,
        evaluatedAt
      )
    ).rejects.toThrow(/draftguru-national-year-page-issue579-private-2019-parser-v3/);
  });

  it('refuses recorded rights with the trade-page one-day cache instead of the reviewed hour', async () => {
    const record = recordedNational(2024);
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
        'draftguru-national-year-page',
        2024,
        evaluatedAt
      )
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
  });

  it('builds a capture command that the scope rules and the recorded decision admit', () => {
    const record = recordedNational(2022);
    const [target] = createLocalDraftguruNationalYearTargets([2022]);
    const command = createDraftguruNationalYearCaptureCommand(record, {
      target: target!,
      capturedAt: evaluatedAt,
      maximumBytes: 1024,
    });
    expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
    expect(command.request).toMatchObject({
      provider: 'draftguru',
      capabilityId: 'draftguru-national-year-page',
      draftPathway: 'national',
      sourceUrl: 'https://www.draftguru.com.au/years/2022',
      parserVersion: 'draftguru-national-year-page/v3',
      effectiveAt: evaluatedAt,
    });
    expect(
      evaluateAflTradeGate0AAgainstDecision(
        record.decision,
        record.sourceRights,
        command.gateRequest
      )
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
  });

  it('refuses an Official AFL authority', () => {
    const [target] = createLocalDraftguruNationalYearTargets([2021]);
    expect(() =>
      createDraftguruNationalYearCaptureCommand(recordedOfficial(2021), {
        target: target!,
        capturedAt: evaluatedAt,
        maximumBytes: 1024,
      })
    ).toThrow(/not a Draftguru national-year capability/);
  });
});

describe('local Draftguru national-year targets', () => {
  it('builds one exact year page per season in season order', () => {
    expect(createLocalDraftguruNationalYearTargets([2024, 2022])).toEqual([
      {
        capabilityId: 'draftguru-national-year-page',
        season: 2022,
        sourceUrl: 'https://www.draftguru.com.au/years/2022',
      },
      {
        capabilityId: 'draftguru-national-year-page',
        season: 2024,
        sourceUrl: 'https://www.draftguru.com.au/years/2024',
      },
    ]);
  });

  it('refuses no seasons and repeated seasons', () => {
    expect(() => createLocalDraftguruNationalYearTargets([])).toThrow(/distinct seasons/);
    expect(() => createLocalDraftguruNationalYearTargets([2022, 2022])).toThrow(/distinct seasons/);
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

  it.each([[[]], [[2020, 2020]], [[2010]], [[2017]], [[2031]]])('rejects seasons %j', (seasons) => {
    expect(() => createLocalOfficialAflDraftSessionTargets(seasons)).toThrow();
  });

  it.each([
    [2011, ['2011', '2011', '2011', '2013']],
    [2012, ['2012', '2012', '2014']],
    [2013, ['2013', '2018', '2019']],
    [2014, ['2014', '2016', '2016', '2018', '2019']],
    [2015, ['2015', '2015']],
    [2016, ['2016', '2016', '2019']],
  ])(
    'enumerates the reviewed %s pages at their own reviewed dates, which ingestion admits',
    (season, years) => {
      const targets = createLocalOfficialAflDraftSessionTargets([season]);
      expect(targets.map(({ effectiveAt }) => effectiveAt.slice(0, 4))).toEqual(years);
      const record = recordedOfficial(season);
      for (const target of targets) {
        expect(target.effectiveAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
        const command = createOfficialAflDraftSessionCaptureCommand(record, {
          target,
          capturedAt: evaluatedAt,
          maximumBytes: 1024,
        });
        expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
        expect(command.request).toMatchObject({
          anchorSeasonYear: season,
          draftPathway: 'national',
          effectiveAt: target.effectiveAt,
          parserVersion: 'official-afl-completed-draft-session/v19',
        });
        expect(
          evaluateAflTradeGate0AAgainstDecision(
            record.decision,
            record.sourceRights,
            command.gateRequest
          )
        ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      }
    }
  );

  it('narrows a season to the named reviewed pages', () => {
    const nightTwo =
      'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait';
    expect(createLocalOfficialAflDraftSessionTargets([2021], [nightTwo])).toEqual([
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2021,
        sourceUrl: nightTwo,
        effectiveAt: '2021-11-25T00:00:00.000Z',
      },
    ]);
  });

  it.each([
    [[]],
    [['https://www.afl.com.au/news/1/not-reviewed']],
    // A reviewed page of a season that was not requested.
    [
      [
        'https://www.afl.com.au/news/528411/every-pick-every-player-check-out-who-your-club-drafted',
      ],
    ],
    [
      [
        'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait',
        'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait',
      ],
    ],
  ])('refuses URLs %j', (urls) => {
    expect(() => createLocalOfficialAflDraftSessionTargets([2021], urls)).toThrow(
      LocalExternalCaptureError
    );
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

  it('parses completed-session URLs as a filter on their seasons', () => {
    const nightTwo =
      'https://www.afl.com.au/news/870364/giants-nab-versatile-tall-with-pick-22-eagles-add-exciting-ruckman/amp';
    const parsed = parse([
      '--artifact-root',
      durable,
      '--capability',
      'official-afl-completed-draft-session',
      '--season',
      '2022',
      '--url',
      nightTwo,
    ]);
    expect(parsed.targets.map(({ sourceUrl }) => sourceUrl)).toEqual([nightTwo]);
  });

  it('parses national-year seasons into their exact year pages', () => {
    const parsed = parse([
      '--artifact-root',
      durable,
      '--capability',
      'draftguru-national-year-page',
      '--season',
      '2023',
      '--season',
      '2022',
    ]);
    expect(parsed.targets.map(({ sourceUrl }) => sourceUrl)).toEqual([
      'https://www.draftguru.com.au/years/2022',
      'https://www.draftguru.com.au/years/2023',
    ]);
  });

  it('refuses a URL for a national-year capture', () => {
    expect(() =>
      parse([
        '--artifact-root',
        durable,
        '--capability',
        'draftguru-national-year-page',
        '--url',
        'https://www.draftguru.com.au/years/2022',
      ])
    ).toThrow(/come from each --season/);
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

function recordedOrder(season: number, clientVersion?: string): RecordedAuthority {
  const authority = officialAflDraftOrderAuthority({
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

const archive2023 =
  'https://web.archive.org/web/20231119230530id_/https://www.afl.com.au/draft/draft-order';
const archive2025 =
  'https://web.archive.org/web/20251113035435id_/https://www.afl.com.au/draft/draft-order';
const archive2026 =
  'https://web.archive.org/web/20261014083707id_/https://www.afl.com.au/draft/draft-order';

describe('recorded Official AFL pre-draft order authority (issue 853)', () => {
  it('loads the per-season decision recorded under the issue579 order-v4 key', async () => {
    const record = recordedOrder(2022);
    expect(record.decision.content.decisionKey).toBe(
      'official-afl-indicative-draft-order-issue579-private-2022-order-v4'
    );
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'official-afl-indicative-draft-order',
      2022,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
  });

  it('refuses a recorded decision for the v1 paragraph parser', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedOrder(2022, 'official-afl-order-parser/v1')),
        'official-afl-indicative-draft-order',
        2022,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-draft-order-parser\/v4/);
  });

  it('loads 2026 only under its order-v5 decision, and refuses a v4 rights record for it', async () => {
    const record = recordedOrder(2026);
    expect(record.decision.content.decisionKey).toBe(
      'official-afl-indicative-draft-order-issue579-private-2026-order-v5'
    );
    expect(record.sourceRights.content.acquisition).toMatchObject({
      clientVersion: 'official-afl-draft-order-parser/v5',
    });
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'official-afl-indicative-draft-order',
      2026,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedOrder(2026, 'official-afl-draft-order-parser/v4')),
        'official-afl-indicative-draft-order',
        2026,
        evaluatedAt
      )
    ).rejects.toThrow(/official-afl-draft-order-parser\/v5/);
  });

  it('builds a command the scope rules and the recorded decision admit, for an article and an archive snapshot', () => {
    for (const season of [2022, 2023, 2025, 2026]) {
      const record = recordedOrder(season);
      for (const target of createLocalOfficialAflDraftOrderTargets([season])) {
        const command = createOfficialAflDraftOrderCaptureCommand(record, {
          target,
          capturedAt: evaluatedAt,
          maximumBytes: 1024,
        });
        expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
        expect(command.request).toMatchObject({
          provider: 'official_afl',
          draftPathway: 'national',
          capabilityId: 'official-afl-indicative-draft-order',
          // 2019-2025 stay on v4; only the 2026 live page is read by v5.
          parserVersion:
            season === 2026
              ? 'official-afl-draft-order-parser/v5'
              : 'official-afl-draft-order-parser/v4',
          effectiveAt: target.effectiveAt,
        });
        expect(
          evaluateAflTradeGate0AAgainstDecision(
            record.decision,
            record.sourceRights,
            command.gateRequest
          )
        ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      }
    }
  });

  it('names every leaf parser v4 emits in the recorded field boundary', () => {
    const record = recordedOrder(2022);
    const [target] = createLocalOfficialAflDraftOrderTargets([2022]);
    const command = createOfficialAflDraftOrderCaptureCommand(record, {
      target: target!,
      capturedAt: evaluatedAt,
      maximumBytes: 1024,
    });
    const html = `<html><body><h4>Final Draft Order as of November 19, 2022</h4>
      <table><tbody><tr><th colspan="2"><h4>ROUND ONE</h4></th></tr></tbody><tbody>
      <tr><td>1</td><td>Greater Western Sydney (received from North Melbourne in a trade)</td></tr>
      <tr><td>2</td><td>North Melbourne</td></tr>
      <tr><td>3</td><td>Brisbane (Dan McStay compensation pick)</td></tr></tbody></table>
      <h4>2023 DRAFT SELECTIONS TRADED</h4></body></html>`;
    const { evidence } = parseOfficialAflDraftOrderTable(html, {
      capture: {
        captureId: `source-capture:${digest('1')}`,
        artifactId: `artifact:${digest('2')}`,
        contentSha256: digest('2'),
        mediaType: 'text/html',
        sourceUrl: target!.sourceUrl,
        capturedAt: evaluatedAt,
        effectiveAt: target!.effectiveAt,
        parserVersion: command.request.parserVersion,
        fieldManifestSha256: command.request.fieldManifestSha256,
      },
      draftYear: 2022,
      observedAt: target!.effectiveAt,
    });
    expect(evidence).toHaveLength(3);
    const receipt = createAflTradeGate0AReceipt(
      { proposals: [record.proposal], decisions: [record.decision] },
      record.sourceRights,
      command.gateRequest,
      evaluatedAt
    );
    expect(() =>
      requireAflTradeExternalEvidenceFieldAuthority({
        evidence,
        sourceRights: record.sourceRights,
        gate0aReceipt: receipt,
      })
    ).not.toThrow();
  });
});

describe('local Official AFL pre-draft order targets', () => {
  it('enumerates one reviewed order page per season, 2019 to 2026, in season order', () => {
    const targets = createLocalOfficialAflDraftOrderTargets([
      2024, 2019, 2026, 2025, 2022, 2023, 2020, 2021,
    ]);
    expect(targets.map(({ season }) => season)).toEqual([
      2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    expect(targets.map(({ sourceUrl }) => new URL(sourceUrl).hostname)).toEqual([
      'www.afl.com.au',
      'www.afl.com.au',
      'www.afl.com.au',
      'www.afl.com.au',
      'web.archive.org',
      'web.archive.org',
      'web.archive.org',
      'web.archive.org',
    ]);
    // 2026: the owner-requested snapshot of the live order, observed on the date it states.
    expect(targets[7]).toEqual({
      capabilityId: 'official-afl-indicative-draft-order',
      season: 2026,
      sourceUrl: archive2026,
      effectiveAt: '2026-10-14T00:00:00.000Z',
    });
    expect(targets[4]).toEqual({
      capabilityId: 'official-afl-indicative-draft-order',
      season: 2023,
      sourceUrl: archive2023,
      effectiveAt: '2023-11-16T00:00:00.000Z',
    });
    // 2025: the first snapshot after the pick-swap window closed, observed on the date it states.
    expect(targets[6]).toEqual({
      capabilityId: 'official-afl-indicative-draft-order',
      season: 2025,
      sourceUrl: archive2025,
      effectiveAt: '2025-11-07T00:00:00.000Z',
    });
  });

  it.each([[[]], [[2022, 2022]], [[2018]], [[2027]]])('rejects seasons %j', (seasons) => {
    expect(() => createLocalOfficialAflDraftOrderTargets(seasons)).toThrow(
      LocalExternalCaptureError
    );
  });

  it.each([
    [[]],
    [['https://www.afl.com.au/news/1/not-reviewed']],
    // A reviewed page of a season that was not requested.
    [[archive2023]],
    [[archive2023.replace('230530', '230531')]],
  ])('refuses URLs %j for 2022', (urls) => {
    expect(() => createLocalOfficialAflDraftOrderTargets([2022], urls)).toThrow(
      LocalExternalCaptureError
    );
  });
});

describe('local capture arguments for pre-draft order pages', () => {
  const durableRoot = process.cwd();
  const env = {
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly:secret@127.0.0.1:5432/outcomes',
    AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly private evaluation (contact: owner@example.test)',
  };
  it('parses order seasons into their reviewed pages and narrows with --url', () => {
    const parsed = parseLocalExternalCaptureArguments(
      [
        '--artifact-root',
        durableRoot,
        '--capability',
        'official-afl-indicative-draft-order',
        '--season',
        '2023',
        '--season',
        '2024',
        '--url',
        archive2023,
      ],
      env,
      []
    );
    expect(parsed.targets).toEqual([
      expect.objectContaining({ season: 2023, sourceUrl: archive2023 }),
    ]);
  });
});

function recordedBoard(season: number, clientVersion?: string): RecordedAuthority {
  const authority = footyinfoDraftBoardAuthority({
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

describe('recorded Footyinfo draft-board authority (issues 853 and 789)', () => {
  it('loads the per-season decision recorded under the issue853 board-v3 key', async () => {
    const record = recordedBoard(2024);
    expect(record.decision.content.decisionKey).toBe(
      'footyinfo-national-draft-board-issue853-private-2024-board-v3'
    );
    const loaded = await loadRecordedLocalCaptureAuthority(
      ledgerOf(record),
      'footyinfo-national-draft-board',
      2024,
      evaluatedAt
    );
    expect(loaded.decisionId).toBe(record.decision.decisionId);
  });

  it('refuses a recorded decision for another parser or with the one-hour cache', async () => {
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(recordedBoard(2024, 'footyinfo-draft-board-parser/v0')),
        'footyinfo-national-draft-board',
        2024,
        evaluatedAt
      )
    ).rejects.toThrow(/footyinfo-draft-board-parser\/v3/);
    const record = recordedBoard(2024);
    const hourly = {
      ...record.sourceRights,
      content: {
        ...record.sourceRights.content,
        automatedAccess: {
          ...record.sourceRights.content.automatedAccess,
          cache: { permitted: true, maximumSeconds: 3_600 },
        },
      },
    };
    await expect(
      loadRecordedLocalCaptureAuthority(
        ledgerOf(record, hourly),
        'footyinfo-national-draft-board',
        2024,
        evaluatedAt
      )
    ).rejects.toThrow(LocalExternalCaptureError);
  });

  it('builds a command the scope rules and the recorded decision admit, and every emitted leaf is reviewed', () => {
    for (const season of [2019, 2024, 2025]) {
      const record = recordedBoard(season);
      const [target] = createLocalFootyinfoDraftBoardTargets([season]);
      const command = createFootyinfoDraftBoardCaptureCommand(record, {
        target: target!,
        capturedAt: evaluatedAt,
        maximumBytes: 1024,
      });
      expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
      expect(command.request).toMatchObject({
        provider: 'footyinfo',
        draftPathway: 'national',
        sourceUrl: `https://www.footyinfo.com/draft/${season}`,
        parserVersion: 'footyinfo-draft-board-parser/v3',
        effectiveAt: evaluatedAt,
      });
      expect(
        evaluateAflTradeGate0AAgainstDecision(
          record.decision,
          record.sourceRights,
          command.gateRequest
        )
      ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      const { evidence, issues } = parseFootyinfoDraftBoard(
        footyinfoBoardPage(SYNTHETIC_BOARD_PICKS, { year: season }),
        {
          capture: {
            captureId: `source-capture:${digest('1')}`,
            artifactId: `artifact:${digest('2')}`,
            contentSha256: digest('2'),
            mediaType: 'text/html',
            sourceUrl: target!.sourceUrl,
            capturedAt: evaluatedAt,
            effectiveAt: evaluatedAt,
            parserVersion: command.request.parserVersion,
            fieldManifestSha256: command.request.fieldManifestSha256,
          },
          draftYear: season,
        }
      );
      expect(issues).toEqual([]);
      // Eight board picks, five selections and one matched bid (parser v2).
      expect(evidence).toHaveLength(14);
      const receipt = createAflTradeGate0AReceipt(
        { proposals: [record.proposal], decisions: [record.decision] },
        record.sourceRights,
        command.gateRequest,
        evaluatedAt
      );
      expect(() =>
        requireAflTradeExternalEvidenceFieldAuthority({
          evidence,
          sourceRights: record.sourceRights,
          gate0aReceipt: receipt,
        })
      ).not.toThrow();
    }
  });
});

describe('local Footyinfo draft-board targets and arguments', () => {
  it('enumerates the one reviewed board per season, 2019 to 2025, in season order', () => {
    expect(createLocalFootyinfoDraftBoardTargets([2025, 2019, 2022])).toEqual([
      {
        capabilityId: 'footyinfo-national-draft-board',
        season: 2019,
        sourceUrl: 'https://www.footyinfo.com/draft/2019',
      },
      {
        capabilityId: 'footyinfo-national-draft-board',
        season: 2022,
        sourceUrl: 'https://www.footyinfo.com/draft/2022',
      },
      {
        capabilityId: 'footyinfo-national-draft-board',
        season: 2025,
        sourceUrl: 'https://www.footyinfo.com/draft/2025',
      },
    ]);
  });

  it.each([[[]], [[2024, 2024]], [[2018]], [[2026]]])('rejects seasons %j', (seasons) => {
    expect(() => createLocalFootyinfoDraftBoardTargets(seasons)).toThrow(LocalExternalCaptureError);
  });

  const env = {
    AFL_OUTCOMES_DATABASE_URL: 'postgresql://statly:secret@127.0.0.1:5432/outcomes',
    AFL_TRADE_EXTERNAL_USER_AGENT: 'Statly private evaluation (contact: owner@example.test)',
  };
  const base = ['--artifact-root', process.cwd(), '--capability', 'footyinfo-national-draft-board'];

  it('parses board seasons and refuses --url', () => {
    expect(
      parseLocalExternalCaptureArguments([...base, '--season', '2024', '--season', '2019'], env, [])
        .targets
    ).toEqual([
      expect.objectContaining({ season: 2019 }),
      expect.objectContaining({ season: 2024 }),
    ]);
    expect(() =>
      parseLocalExternalCaptureArguments(
        [...base, '--season', '2024', '--url', 'https://www.footyinfo.com/draft/2024'],
        env,
        []
      )
    ).toThrow(/--season only/);
  });
});
