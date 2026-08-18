import { z } from 'zod';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '../source/sourceRights';
import type { AflTradeValuationInputBlocker } from './preparedValuationInputSet';

const inputSchema = z
  .object({
    rights: z.array(aflTradeSourceRightsProposalSchema).min(1).max(1_000),
    evaluatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AflTradeValuationSourcePolicyPreflight =
  | {
      readonly state: 'requires_authenticated_dataset_admission';
      readonly evidenceRefs: readonly AflTradeArtifactRef[];
    }
  | {
      readonly state: 'blocked';
      readonly blockers: readonly AflTradeValuationInputBlocker[];
    };

function isCurrentAt(rights: AflTradeSourceRightsProposal, evaluatedAt: number): boolean {
  const effectiveAt = rights.content.termsEffectiveAt;
  const expiresAt = rights.content.termsExpireAt;
  return (
    effectiveAt !== null &&
    Date.parse(effectiveAt) <= evaluatedAt &&
    (expiresAt === null || evaluatedAt < Date.parse(expiresAt))
  );
}

function permitsValuationDerivation(rights: AflTradeSourceRightsProposal): boolean {
  return (
    rights.content.operations.model_training === 'allowed' &&
    rights.content.operations.derived_feature_creation === 'allowed' &&
    rights.content.fields.every(
      ({ uses }) => uses.model_training === 'allowed' && uses.derived_feature === 'allowed'
    )
  );
}

/**
 * Performs the deterministic source-policy portion of valuation admission. A positive result is
 * deliberately insufficient to score: callers must still authenticate the factual release,
 * admitted datasets, current Gate 3 model runs, identities, lineage, and component outputs.
 */
export function assessAflTradeValuationSourcePolicyPreflight(
  input: z.input<typeof inputSchema>
): AflTradeValuationSourcePolicyPreflight {
  const parsed = inputSchema.parse(input);
  const rightsIds = parsed.rights.map(({ rightsArtifactId }) => rightsArtifactId);
  if (new Set(rightsIds).size !== rightsIds.length) {
    throw new TypeError('Valuation source admission requires unique source-rights proposals.');
  }

  const evaluatedAt = Date.parse(parsed.evaluatedAt);
  const evaluated = parsed.rights.map((rights) => ({
    rights,
    evidenceRef: createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt),
  }));
  const blockers = evaluated
    .filter(
      ({ rights }) => !isCurrentAt(rights, evaluatedAt) || !permitsValuationDerivation(rights)
    )
    .map(({ rights, evidenceRef }): AflTradeValuationInputBlocker => ({
      code: 'source_blocked',
      subject: { kind: 'source', id: rights.content.registerId },
      evidenceRefs: [evidenceRef],
    }))
    .sort((left, right) =>
      `${left.code}\u0000${left.subject.kind}\u0000${left.subject.id}`.localeCompare(
        `${right.code}\u0000${right.subject.kind}\u0000${right.subject.id}`
      )
    );

  if (blockers.length > 0) return { state: 'blocked', blockers };
  return {
    state: 'requires_authenticated_dataset_admission',
    evidenceRefs: evaluated
      .map(({ evidenceRef }) => evidenceRef)
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  };
}
