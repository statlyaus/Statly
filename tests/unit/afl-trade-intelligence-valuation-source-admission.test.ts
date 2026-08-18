import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import { assessAflTradeValuationSourcePolicyPreflight } from '@/server/aflTradeIntelligence/valuation/valuationSourceAdmission';

describe('AFL trade valuation source admission', () => {
  it('classifies the current five-season and official local authority as source-blocked', () => {
    const rights = [
      createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.sourceRights,
      createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights,
    ];

    const admission = assessAflTradeValuationSourcePolicyPreflight({
      rights,
      evaluatedAt: '2026-08-15T03:00:00.000Z',
    });

    expect(admission).toMatchObject({
      state: 'blocked',
      blockers: [
        { code: 'source_blocked', subject: { kind: 'source' } },
        { code: 'source_blocked', subject: { kind: 'source' } },
      ],
    });
  });

  it('requires authenticated dataset admission after policy becomes mechanically eligible', () => {
    const current = createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights;
    const content = {
      ...current.content,
      operations: {
        ...current.content.operations,
        model_training: 'allowed' as const,
        derived_feature_creation: 'allowed' as const,
      },
      fields: current.content.fields.map((field) => ({
        ...field,
        uses: {
          ...field.uses,
          model_training: 'allowed' as const,
          derived_feature: 'allowed' as const,
        },
      })),
    };
    const granted = aflTradeSourceRightsProposalSchema.parse({
      rightsArtifactId: createAflTradeContentAddress('source-rights', content),
      content,
    });

    expect(
      assessAflTradeValuationSourcePolicyPreflight({
        rights: [granted],
        evaluatedAt: '2026-08-15T03:00:00.000Z',
      })
    ).toMatchObject({ state: 'requires_authenticated_dataset_admission' });
  });

  it('fails closed after otherwise eligible rights expire', () => {
    const current = createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights;
    expect(
      assessAflTradeValuationSourcePolicyPreflight({
        rights: [current],
        evaluatedAt: '2027-08-14T00:00:00.000Z',
      })
    ).toMatchObject({ state: 'blocked' });
  });
});
