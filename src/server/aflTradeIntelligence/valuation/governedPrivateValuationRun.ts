import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  governedPrivateValuationCalculationInputSchema,
  type GovernedPrivateValuationCalculationInput,
} from './governedPrivateValuationCalculationInput';
import {
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';

export interface GovernedPrivateValuationRunInput {
  readonly calculationInput: GovernedPrivateValuationCalculationInput;
  readonly calculatedAt: string;
}

export interface GovernedPrivateValuationRun {
  readonly calculationInputId: string;
  readonly calculationInputArtifact: AflTradeArtifactRef;
  readonly calculation: AflTradeValuationCalculation;
  readonly calculationArtifact: AflTradeArtifactRef;
  readonly environment: 'non_production';
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
}

export function runGovernedPrivateValuation(
  candidate: GovernedPrivateValuationRunInput
): GovernedPrivateValuationRun {
  const calculationInput = governedPrivateValuationCalculationInputSchema.parse(
    candidate.calculationInput
  );
  const calculatedAt = Date.parse(candidate.calculatedAt);
  if (
    !Number.isFinite(calculatedAt) ||
    calculatedAt < Date.parse(calculationInput.content.createdAt)
  ) {
    throw new TypeError(
      'Governed private valuation calculation time cannot predate its authenticated input.'
    );
  }

  const calculation = calculateAflTradeValuation(
    calculationInput.content.valuationCase,
    calculationInput.content.componentDrawSet,
    calculationInput.content.realizedContributionLedger,
    calculationInput.content.packagePolicy
  );
  const { authority, valuationCase } = calculationInput.content;
  if (
    calculation.content.valuationCaseId !== valuationCase.valuationCaseId ||
    calculation.content.valuationBundleId !== authority.valuationBundle.bundleId ||
    calculation.content.valueUnitId !== authority.confirmedFacts.valueUnitId
  ) {
    throw new TypeError(
      'Governed private valuation output does not exactly match its admitted authority ancestry.'
    );
  }

  return Object.freeze({
    calculationInputId: calculationInput.calculationInputId,
    calculationInputArtifact: createAflTradeCanonicalJsonArtifactRef(
      calculationInput,
      calculationInput.content.createdAt
    ),
    calculation,
    calculationArtifact: createAflTradeCanonicalJsonArtifactRef(
      calculation,
      candidate.calculatedAt
    ),
    environment: 'non_production' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  });
}
