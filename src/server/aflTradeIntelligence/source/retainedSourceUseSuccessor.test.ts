import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { createAflTradeRetainedSourceUseSuccessor } from './retainedSourceUseSuccessor';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (prefix: string, character: string) => `${prefix}:${character.repeat(64)}`;
const condition =
  'Document exact fields, source provenance, coverage gaps and uncertainty for each consuming method.';
const approval = JSON.stringify({
  decision: 'approved',
  approvedBy: 'statly-product-owner',
  approvedAt: '2026-09-19T01:58:09.692Z',
  ownerAuthorization: {
    approvedUses: [
      'factual evaluation',
      'model training and approval',
      'valuation and grading',
      'public data and grade publication',
      'live product activation',
      'retained source evidence as a basis for other documented methods',
    ],
    condition: 'Document the method and uncertainty; satisfy separate technical gates.',
    scope: 'Exact retained evidence and other documented methods.',
  },
});
const capture = {
  captureId: id('source-capture', 'a'),
  recordedAt: '2026-09-12T20:58:17.622Z',
  recordSha256: 'b'.repeat(64),
  gateDecisionId: id('gate-decision', 'c'),
  rightsArtifactId: id('source-rights', 'd'),
  sourceSnapshotId: id('source-snapshot', 'e'),
};
const input = {
  schemaVersion: 'statly-retained-source-use-successor-input/v1',
  recordedAt: '2026-09-19T04:48:50.207Z',
  state: 'exact_input_prepared_technical_admission_pending',
  factualReleaseId: id('outcome-release', 'f'),
  sourceCaptureSetSha256: hash(canonicalizeAflTradeJson([capture])),
  ownerApprovalPath:
    'source-package/admission-preparation/cameron-pav/accountable-owner-approval.json',
  ownerApprovalSha256: hash(approval),
  ownerApprovedUses: [
    'model_training',
    'derived_feature_creation',
    'public_derived_output',
    'public_fact_display',
    'live_product_activation',
    'other_documented_methods',
  ],
  condition,
  captureBindings: [capture],
  originalRights: [
    {
      rightsArtifactId: capture.rightsArtifactId,
      provider: 'official_afl',
      dataset: 'Reviewed factual evidence',
      fields: [
        {
          sourceField: 'player.name',
          normalizedField: 'player.name',
          attributionRequired: true,
          notes: null,
          uses: {
            archive_fact: 'allowed',
            model_training: 'blocked',
            derived_feature: 'blocked',
            public_display: 'blocked',
          },
        },
      ],
    },
  ],
  captureCount: 1,
  rightsCount: 1,
};

describe('retained source-use successor', () => {
  it('seals the exact owner-approved capture and original field scope without rewriting old rights', () => {
    const successor = createAflTradeRetainedSourceUseSuccessor(input, approval);
    expect(successor.successorId).toMatch(/^retained-source-use-successor:[a-f0-9]{64}$/u);
    expect(successor.content.captureBindings).toEqual([capture]);
    expect(successor.content.originalRights[0]?.fields[0]?.uses.model_training).toBe('blocked');
    expect(successor.content.rawFieldRedistributionPermitted).toBe(false);
    expect(successor.content.state).toBe('candidate_requires_durable_authentication');
    expect(createAflTradeRetainedSourceUseSuccessor(input, approval)).toEqual(successor);
  });

  it('rejects altered capture custody, an omitted rights proposal, or substituted owner approval', () => {
    expect(() =>
      createAflTradeRetainedSourceUseSuccessor(
        {
          ...input,
          captureBindings: [{ ...capture, sourceSnapshotId: id('source-snapshot', '1') }],
        },
        approval
      )
    ).toThrow('exact capture set');
    expect(() =>
      createAflTradeRetainedSourceUseSuccessor({ ...input, originalRights: [] }, approval)
    ).toThrow();
    expect(() =>
      createAflTradeRetainedSourceUseSuccessor(input, approval.replace('approved', 'rejected'))
    ).toThrow();
  });
});
