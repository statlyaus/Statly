import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  createAflTradeRetainedMethodSourceUse,
  verifyAflTradeRetainedMethodSourceUse,
} from './retainedMethodSourceUse';
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
        {
          sourceField: 'player.age',
          normalizedField: 'player.age',
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

describe('retained method source-use binding', () => {
  const method = {
    methodArtifactId: id('artifact', '1'),
    methodName: 'Cameron provisional valuation pilot',
    operation: 'derived_feature_creation',
    captureUses: [
      {
        captureId: capture.captureId,
        rightsArtifactId: capture.rightsArtifactId,
        sourceFields: ['player.name'],
      },
    ],
    provenance: 'Reviewed Cameron factual release.',
    coverageGaps: 'Numerical history is not yet admitted.',
    uncertainty: 'No grade is available.',
  } as const;

  it('binds one method, operation, capture, rights proposal and consumed field set', () => {
    const successor = createAflTradeRetainedSourceUseSuccessor(input, approval);
    const binding = createAflTradeRetainedMethodSourceUse(successor, method);
    expect(binding.methodUseId).toMatch(/^retained-source-method-use:[a-f0-9]{64}$/u);
    expect(binding.content.captureUses).toEqual(method.captureUses);
    expect(successor.content.originalRights[0]?.fields).toHaveLength(2);
    expect(binding.content.captureUses[0]?.sourceFields).toEqual(['player.name']);
    expect(verifyAflTradeRetainedMethodSourceUse(successor, binding)).toBe(true);
    expect(
      verifyAflTradeRetainedMethodSourceUse(successor, {
        ...binding,
        content: { ...binding.content, methodArtifactId: id('artifact', '2') },
      })
    ).toBe(false);
  });

  it('rejects an unretained field, a mismatched capture-right pair and duplicate capture use', () => {
    const successor = createAflTradeRetainedSourceUseSuccessor(input, approval);
    const use = method.captureUses[0];
    expect(use).toBeDefined();
    if (use === undefined) return;
    expect(() =>
      createAflTradeRetainedMethodSourceUse(successor, {
        ...method,
        captureUses: [{ ...use, sourceFields: ['player.height'] }],
      })
    ).toThrow('exact retained capture or field scope');
    expect(() =>
      createAflTradeRetainedMethodSourceUse(successor, {
        ...method,
        captureUses: [{ ...use, rightsArtifactId: id('source-rights', '9') }],
      })
    ).toThrow('exact retained capture or field scope');
    expect(() =>
      createAflTradeRetainedMethodSourceUse(successor, {
        ...method,
        captureUses: [use, use],
      })
    ).toThrow('repeat a retained source capture');
  });
});
