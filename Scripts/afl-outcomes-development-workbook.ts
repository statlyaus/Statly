import { evaluateAflOutcomesDevelopmentWorkbook } from '@/server/aflTradeIntelligence/source/developmentWorkbookEvaluation';
import {
  fingerprintAflOutcomesDevelopmentWorkbook,
  loadAflOutcomesDevelopmentWorkbook,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { AflOutcomesDevelopmentWorkbookError } from '@/server/aflTradeIntelligence/source/developmentWorkbookStructure';

async function main() {
  const workbookPath = process.env.AFL_OUTCOMES_DEV_WORKBOOK_PATH ?? '';
  const expectedSha256 = process.env.AFL_OUTCOMES_DEV_WORKBOOK_SHA256;

  if (!expectedSha256) {
    const fingerprint = await fingerprintAflOutcomesDevelopmentWorkbook({ workbookPath });
    console.log(
      JSON.stringify(
        {
          mode: 'fingerprint_only',
          productionAuthority: 'none',
          ...fingerprint,
          nextCommand:
            'Set AFL_OUTCOMES_DEV_WORKBOOK_SHA256 to this digest and rerun for structural evaluation.',
        },
        null,
        2
      )
    );
    return;
  }

  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256,
  });
  console.log(
    JSON.stringify(
      {
        mode: 'development_evaluation',
        productionAuthority: 'none',
        publicationAuthority: 'none',
        workbook: workbook.report,
        evaluation: evaluateAflOutcomesDevelopmentWorkbook(workbook),
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  if (error instanceof AflOutcomesDevelopmentWorkbookError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error('UNEXPECTED_DEVELOPMENT_WORKBOOK_FAILURE');
  }
  process.exitCode = 1;
});
