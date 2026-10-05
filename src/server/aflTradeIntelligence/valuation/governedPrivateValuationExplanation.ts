import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  governedPrivateValuationCalculationInputSchema,
  type GovernedPrivateValuationCalculationInput,
} from './governedPrivateValuationCalculationInput';
import type { GovernedPrivateValuationRun } from './governedPrivateValuationRun';
import {
  createAflTradeValuationExplanation,
  type AflTradeGovernedValuationExplanationEvidence,
  type AflTradeValuationExplanationResult,
  type AflTradeValuationExplanationTransfer,
} from './tradeValuationExplanation';

type GovernedExplanationPolicy =
  AflTradeGovernedValuationExplanationEvidence['content']['explanationPolicy'];

export interface CreateGovernedPrivateValuationExplanationInput {
  readonly calculationInput: GovernedPrivateValuationCalculationInput;
  readonly run: GovernedPrivateValuationRun;
  readonly transfers: readonly AflTradeValuationExplanationTransfer[];
  readonly explanationPolicy: GovernedExplanationPolicy;
  readonly selectedLayer?: 'gross' | 'listSpotAdjusted' | 'scarcityAdjusted';
  readonly confidenceLevel: 'low' | 'moderate' | 'high';
  readonly explainedAt: string;
}

export interface GovernedPrivateValuationExplanationAssembly {
  readonly directionEvidence: AflTradeGovernedValuationExplanationEvidence;
  readonly directionEvidenceArtifact: AflTradeArtifactRef;
  readonly explanation: AflTradeValuationExplanationResult;
  readonly explanationArtifact: AflTradeArtifactRef | null;
  readonly publicationEligible: false;
  readonly publicationProhibited: true;
}

export function createGovernedPrivateValuationExplanation(
  candidate: CreateGovernedPrivateValuationExplanationInput
): GovernedPrivateValuationExplanationAssembly {
  const calculationInput = governedPrivateValuationCalculationInputSchema.parse(
    candidate.calculationInput
  );
  if (
    candidate.run.calculationInputId !== calculationInput.calculationInputId ||
    candidate.run.environment !== 'non_production' ||
    candidate.run.publicationEligible !== false ||
    candidate.run.publicationProhibited !== true ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.run.calculationInputArtifact,
      calculationInput
    ) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      candidate.run.calculationArtifact,
      candidate.run.calculation
    )
  ) {
    throw new TypeError(
      'Governed explanation requires one exact authenticated non-production calculation run.'
    );
  }
  if (
    !Number.isFinite(Date.parse(candidate.explainedAt)) ||
    Date.parse(candidate.explainedAt) < Date.parse(candidate.run.calculationArtifact.createdAt)
  ) {
    throw new TypeError('Governed explanation cannot predate its calculation artifact.');
  }

  const valuationCase = calculationInput.content.valuationCase;
  const content: AflTradeGovernedValuationExplanationEvidence['content'] = {
    schemaVersion: 'local-private-governed-explanation-evidence/v1',
    evidenceClassification: 'retained_factual_and_governed_model_output',
    governedCalculationInputId: calculationInput.calculationInputId,
    tradeId: calculationInput.content.tradeId,
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: candidate.run.calculation.valuationCalculationId,
    transferDirections: [...candidate.transfers],
    explanationPolicy: candidate.explanationPolicy,
    effectiveAt: valuationCase.content.viewContexts.find(({ view }) => view === 'at_trade')!
      .effectiveAt,
    effectiveThrough: valuationCase.content.viewContexts.find(({ view }) => view === 'current')!
      .effectiveAt,
    publicationEligible: false,
  };
  const directionEvidence: AflTradeGovernedValuationExplanationEvidence = {
    evidenceId: createAflTradeContentAddress('artifact', content),
    content,
  };
  const directionEvidenceArtifact = createAflTradeCanonicalJsonArtifactRef(
    content,
    candidate.explainedAt
  );
  if (directionEvidenceArtifact.artifactId !== directionEvidence.evidenceId) {
    throw new TypeError('Governed direction evidence artifact address mismatch.');
  }

  const explanation = createAflTradeValuationExplanation({
    authority: calculationInput.content.authority,
    governedDirectionEvidence: directionEvidence,
    valuationCase,
    valuationCalculation: candidate.run.calculation,
    selectedLayer: candidate.selectedLayer ?? 'scarcityAdjusted',
    gradeContext: {
      confidenceLevel: candidate.confidenceLevel,
      developmentPreview: true,
    },
  });
  return Object.freeze({
    directionEvidence,
    directionEvidenceArtifact,
    explanation,
    explanationArtifact:
      explanation.state === 'available'
        ? createAflTradeCanonicalJsonArtifactRef(explanation.document, candidate.explainedAt)
        : null,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  });
}
