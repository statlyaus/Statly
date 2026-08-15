import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { prepareLocalWorkbookSyntheticValuation } from '@/server/aflTradeIntelligence/development/localWorkbookSyntheticValuation';
import { loadAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

const ASSESSED_AT = '2026-08-15T00:00:00.000Z';

function required(name: 'AFL_OUTCOMES_DEV_WORKBOOK_PATH' | 'AFL_OUTCOMES_DEV_WORKBOOK_SHA256') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Local workbook synthetic valuation verification is production-prohibited.');
  }
  const workbookPath = required('AFL_OUTCOMES_DEV_WORKBOOK_PATH');
  const workbookSha256 = required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256').toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(workbookSha256)) {
    throw new Error('AFL_OUTCOMES_DEV_WORKBOOK_SHA256 must be a SHA-256 digest.');
  }
  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256: workbookSha256,
    runtimeEnvironment: process.env.NODE_ENV,
  });
  const projection = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
  const valuationBundleId = createAflTradeContentAddress('valuation-bundle', {
    schemaVersion: 'local-workbook-synthetic-valuation-bundle/v1',
    workbookSha256,
    evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
  });
  const unavailable: Array<{ tradeId: string; reason: string }> = [];
  let ready = 0;
  let numericalPartyViews = 0;
  for (const [tradeId, trade] of projection.detailsById) {
    const prepared = prepareLocalWorkbookSyntheticValuation({
      environment: 'test_fixture',
      trade,
      workbookSha256,
      valuationBundleId,
      scenario: 'baseline',
      assessedAt: ASSESSED_AT,
    });
    if (prepared.state === 'unavailable') {
      unavailable.push({ tradeId, reason: prepared.reason });
      continue;
    }
    if (
      prepared.publicationEligible ||
      prepared.scenario.authority.publicationEligible ||
      !prepared.scenario.authority.publicationProhibited
    ) {
      throw new Error(`Synthetic scenario ${tradeId} escaped its private authority boundary.`);
    }
    const partyViews = prepared.summary.views.flatMap(({ parties }) => parties);
    if (
      partyViews.length === 0 ||
      partyViews.some(({ received, givenUp, netAdvantage }) =>
        [received, givenUp, netAdvantage].some((value) => !Number.isFinite(value))
      )
    ) {
      throw new Error(`Synthetic scenario ${tradeId} has non-numerical calculation output.`);
    }
    ready += 1;
    numericalPartyViews += partyViews.length;
  }
  if (projection.detailsById.size === 0) {
    throw new Error('The pinned workbook contains no projected trades.');
  }
  if (unavailable.length > 0) {
    throw new Error(
      `${unavailable.length} workbook trades are unavailable for synthetic calculation: ${JSON.stringify(unavailable.slice(0, 10))}`
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'verified',
        evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
        publicationEligible: false,
        totalTrades: projection.detailsById.size,
        scenarioReadyTrades: ready,
        numericalPartyViews,
        years: projection.years,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
