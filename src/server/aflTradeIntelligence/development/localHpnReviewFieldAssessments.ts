import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  listAflTradeHpnRequiredSemanticFields,
  type AflTradeHpnCalculationFieldAssessmentInput,
  type AflTradeHpnRequiredSemanticField,
} from '../modeling/hpnCalculationEligibility';
import {
  listAflTradeHpnCandidateSourceFields,
  type AflTradeHpnFieldMapCandidate,
  type AflTradeHpnSemanticBindingCandidate,
} from '../modeling/hpnFieldMapCandidate';
import type { AflTradeHpnProjectedFieldMap } from '../modeling/hpnProjectedFieldMap';
import type { AflTradeHpnPrivateCalculationSourceUseAssessment } from '../modeling/hpnPrivateCalculationSourceUse';

const identityFields = new Set(['player', 'match', 'club', 'homeClub', 'awayClub']);

export function createMissingLocalAflTradeHpnFields(
  inputKind: 'completed_match_result' | 'player_match_stats',
  evidenceRef: AflTradeArtifactRef
): readonly AflTradeHpnCalculationFieldAssessmentInput[] {
  return listAflTradeHpnRequiredSemanticFields(inputKind).map((semanticField) => ({
    semanticField,
    sourceFields: [semanticField],
    rawAvailability: { state: 'missing', evidenceRefs: [evidenceRef] },
    fieldMapReview: { state: 'missing', evidenceRefs: [evidenceRef] },
    sourceUse: { state: 'unreviewed', evidenceRefs: [evidenceRef] },
    factualReview: { state: 'missing', evidenceRefs: [evidenceRef] },
    canonicalIdentity: { state: 'incomplete', evidenceRefs: [evidenceRef] },
  }));
}

function candidateBinding(
  candidate: AflTradeHpnFieldMapCandidate,
  semanticField: AflTradeHpnRequiredSemanticField
): AflTradeHpnSemanticBindingCandidate {
  const binding = candidate.content.semanticBindings.find(
    (item) => item.semanticField === semanticField
  );
  if (!binding) throw new TypeError(`HPN candidate is missing ${semanticField}.`);
  return binding;
}

function approvedSourceFields(
  map: AflTradeHpnProjectedFieldMap,
  semanticField: AflTradeHpnRequiredSemanticField
): readonly string[] {
  const binding = map.content.semanticBindings.find(
    (candidate) => candidate.semanticField === semanticField
  );
  return binding ? listAflTradeHpnCandidateSourceFields(binding) : [];
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index]);
}

export function createSelectedLocalAflTradeHpnFields(input: Readonly<{
  candidate: AflTradeHpnFieldMapCandidate;
  candidateArtifact: AflTradeArtifactRef;
  decodeMapArtifact: AflTradeArtifactRef;
  sourceUseAssessment: AflTradeHpnPrivateCalculationSourceUseAssessment;
  sourceUseAssessmentArtifact: AflTradeArtifactRef;
  currentMap: AflTradeHpnProjectedFieldMap | null;
  currentMapArtifact: AflTradeArtifactRef | null;
  factualRunId: string | null;
  hpnResolutionsCurrent: boolean;
  authoritySnapshotArtifact: AflTradeArtifactRef;
}>): readonly AflTradeHpnCalculationFieldAssessmentInput[] {
  return listAflTradeHpnRequiredSemanticFields(input.candidate.content.inputKind).map(
    (semanticField): AflTradeHpnCalculationFieldAssessmentInput => {
      const sourceFields = listAflTradeHpnCandidateSourceFields(
        candidateBinding(input.candidate, semanticField)
      );
      if (
        input.currentMap !== null &&
        (input.currentMap.content.candidateId !== input.candidate.candidateId ||
          !exactStringSet(sourceFields, approvedSourceFields(input.currentMap, semanticField)))
      ) {
        throw new TypeError('The current HPN map conflicts with its exact review candidate.');
      }
      const sourceUsePermitted = sourceFields.every((sourceField) =>
        input.sourceUseAssessment.content.fields.some(
          (field) => field.sourceField === sourceField &&
            field.state === 'permitted_private_calculation'
        )
      );
      const identity = identityFields.has(semanticField);
      return {
        semanticField,
        sourceFields: [...sourceFields],
        rawAvailability: { state: 'available', evidenceRefs: [input.decodeMapArtifact] },
        fieldMapReview: input.currentMap && input.currentMapArtifact
          ? {
              state: 'current_approved',
              fieldMapId: input.currentMap.fieldMapId,
              evidenceRefs: [input.currentMapArtifact],
            }
          : { state: 'missing', evidenceRefs: [input.candidateArtifact] },
        sourceUse: {
          state: sourceUsePermitted ? 'permitted_private_calculation' : 'not_permitted',
          evidenceRefs: [input.sourceUseAssessmentArtifact],
        },
        factualReview: {
          state: input.factualRunId === null ? 'missing' : 'current_approved',
          evidenceRefs: [input.authoritySnapshotArtifact],
        },
        canonicalIdentity: {
          state: identity
            ? input.hpnResolutionsCurrent ? 'current_approved' : 'incomplete'
            : 'not_applicable',
          evidenceRefs: [input.authoritySnapshotArtifact],
        },
      };
    }
  );
}
