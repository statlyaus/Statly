import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createAflTradePrivateValuationHpnSourceAdmission } from '@/server/aflTradeIntelligence/valuation/privateValuationHpnSourceAdmission';
import { createAflTradePrivateValuationRawDataCoordinator } from '@/server/aflTradeIntelligence/valuation/privateValuationRawDataCoordinator';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { parseAflTradePrivateValuationCaptureBinding } from '@/server/aflTradeIntelligence/valuation/privateValuationCaptureBinding';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';

import {
  createAflTradePrivateValuationSupplementalSourceAdmission,
  parseAflTradePrivateValuationSourceAdmission,
  parseAflTradePrivateValuationSupplementalSourceAdmission,
} from '@/server/aflTradeIntelligence/valuation/privateValuationSourceAdmission';

// Structural synthetic custody only: this constructor grants no SQL authority.
const input = {
  requestId: `private-valuation-dispatch:${'1'.repeat(64)}`,
  primarySourceAdmissionId: `private-valuation-source-admission:${'2'.repeat(64)}`,
  sourceRole: 'hpn_primary_player_stats' as const,
  captureBindingId: `private-valuation-capture-binding:${'3'.repeat(64)}`,
  sourceCaptureId: `source-capture:${'4'.repeat(64)}`,
  normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
  factBatchId: `source-fact-batch:${'6'.repeat(64)}`,
  factualRunId: `factual-reconciliation-run:${'7'.repeat(64)}`,
  admittedAt: '2026-09-09T06:00:00.000Z',
};

it('retains an explicitly supplemental source under the same request without impersonating primary admission', () => {
  const admission = createAflTradePrivateValuationSupplementalSourceAdmission(input);
  expect(admission.content).toMatchObject({
    schemaVersion: 'afl-trade-private-valuation-source-admission/v2',
    requestId: input.requestId,
    primarySourceAdmissionId: input.primarySourceAdmissionId,
    sourceRole: 'hpn_primary_player_stats',
    publicationEligible: false,
    publicationProhibited: true,
  });
  expect(parseAflTradePrivateValuationSupplementalSourceAdmission(admission)).toEqual(admission);
  expect(() => parseAflTradePrivateValuationSourceAdmission(admission)).toThrow();
});

it('rejects primary-role relabelling, missing primary ancestry and changed retained content', () => {
  const admission = createAflTradePrivateValuationSupplementalSourceAdmission(input);
  for (const content of [
    { ...admission.content, sourceRole: 'factual_input' },
    { ...admission.content, primarySourceAdmissionId: null },
    { ...admission.content, undeclaredPermission: 'model_training' },
  ]) {
    expect(() =>
      parseAflTradePrivateValuationSupplementalSourceAdmission({
        admissionId: createAflTradeContentAddress('private-valuation-source-admission', content),
        content,
      })
    ).toThrow();
  }
  expect(() =>
    parseAflTradePrivateValuationSupplementalSourceAdmission({
      ...admission,
      content: {
        ...admission.content,
        factualRunId: `factual-reconciliation-run:${'f'.repeat(64)}`,
      },
    })
  ).toThrow('content address');
});

function sourceFirstBinding(
  sourceRole: 'factual_input' | 'hpn_primary_player_stats' = 'hpn_primary_player_stats'
) {
  const content = {
    schemaVersion: 'afl-trade-private-valuation-capture-binding/v3',
    authorityKind: 'source_first',
    request: {
      requestId: input.requestId,
      scopeKey: 'afl-men:2025-trades',
      trigger: 'ad_hoc',
      scheduledFor: '2026-09-09T05:00:00.000Z',
      authorityKey: 'synthetic-source-first',
    },
    dispatchClaimId: `private-valuation-dispatch-claim:${'8'.repeat(64)}`,
    attemptSequence: 1,
    attemptNumber: 1,
    sourceRole,
    sourceCaptureAttemptId: `source-capture-attempt:${'9'.repeat(64)}`,
    captureReceiptId: `fitzroy-capture:${'a'.repeat(64)}`,
    snapshotId: `source-snapshot:${'b'.repeat(64)}`,
    sourceCaptureId: input.sourceCaptureId,
    normalizationRunId: input.normalizationRunId,
    acceptedAt: input.admittedAt,
    environment: 'non_production',
    publicationEligible: false,
    limitation:
      'Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.',
    sourcePlan: {
      provider: 'afl_tables',
      dataset: 'AFL Tables historical player match statistics',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      seasonYear: 2025,
      fieldMapId: 'synthetic-appearance-map',
      gate0AReceiptId: `gate0a-evaluation:${'c'.repeat(64)}`,
      rightsArtifactId: `source-rights:${'d'.repeat(64)}`,
    },
  };
  const binding = {
    bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
    content,
  };
  return binding;
}

it('routes primary retained-source acceptance explicitly and replays without another capture', async () => {
  const binding = parseAflTradePrivateValuationCaptureBinding(sourceFirstBinding('factual_input'));
  let retained = false;
  let captures = 0;
  let accepts = 0;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters?: readonly unknown[]) {
      if (statement.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (statement.includes('accept_outcome_private_valuation_source_first_capture')) {
        expect(parameters?.[3]).toBe('factual_input');
        accepts += 1;
        retained = true;
      } else if (!statement.includes('FROM outcome_private_valuation_capture_binding')) {
        throw new Error('Unexpected SQL operation; legacy acceptance is forbidden here.');
      }
      const rows = retained ? [{ binding_json: binding }] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: (work) => work(sql),
  };
  const coordinator = createAflTradePrivateValuationRawDataCoordinator({
    captureBindings: new PostgresAflTradePrivateValuationCaptureBindingRepository(sql),
    captureAuthority: 'source_first',
    capture: async () => {
      captures += 1;
      return { normalizationRunId: binding.content.normalizationRunId };
    },
  });
  const command = {
    request: binding.content.request,
    claim: { claimId: binding.content.dispatchClaimId, leaseToken: '9'.repeat(64) },
  };
  await expect(coordinator.run(command)).resolves.toMatchObject({
    binding,
    idempotentReplay: false,
  });
  await expect(coordinator.run(command)).resolves.toMatchObject({
    binding,
    idempotentReplay: true,
  });
  expect({ captures, accepts }).toEqual({ captures: 1, accepts: 1 });
});

it('rejects unavailable source-first acceptance before any provider side effect', () => {
  expect(() =>
    createAflTradePrivateValuationRawDataCoordinator({
      captureAuthority: 'source_first',
      captureBindings: {
        load: async () => null,
        accept: async () => {
          throw new Error('Legacy must not run');
        },
      },
      capture: async () => {
        throw new Error('Provider must not run');
      },
    })
  ).toThrow('source-first');
});

it('rejects retained custody from the other explicitly selected authority before capture', async () => {
  const sourceFirst = sourceFirstBinding('factual_input');
  const { authorityKind: _authorityKind, ...previousContent } = sourceFirst.content;
  const legacyContent = {
    ...previousContent,
    schemaVersion: 'afl-trade-private-valuation-capture-binding/v2',
  };
  const legacy = parseAflTradePrivateValuationCaptureBinding({
    bindingId: createAflTradeContentAddress('private-valuation-capture-binding', legacyContent),
    content: legacyContent,
  });
  for (const captureAuthority of ['legacy', 'source_first'] as const) {
    const retained =
      captureAuthority === 'legacy'
        ? parseAflTradePrivateValuationCaptureBinding(sourceFirst)
        : legacy;
    const sql: AflOutcomeSqlClient = {
      async query<Row>(statement: string) {
        if (statement.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
        if (!statement.includes('FROM outcome_private_valuation_capture_binding'))
          throw new Error('No acceptance expected');
        return { rows: [{ binding_json: retained }] as Row[], rowCount: 1 };
      },
      transaction: (work) => work(sql),
    };
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureAuthority,
      captureBindings: new PostgresAflTradePrivateValuationCaptureBindingRepository(sql),
      capture: async () => {
        throw new Error('No capture expected');
      },
    });
    await expect(
      coordinator.run({
        request: retained.content.request,
        claim: { claimId: retained.content.dispatchClaimId, leaseToken: '9'.repeat(64) },
      })
    ).rejects.toThrow('selected capture authority');
  }
});

it('does not adopt source-first custody through the legacy repository acceptance method', async () => {
  const binding = parseAflTradePrivateValuationCaptureBinding(sourceFirstBinding('factual_input'));
  let completedTransactions = 0;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string) {
      return statement.startsWith('SET LOCAL')
        ? { rows: [], rowCount: 0 }
        : { rows: [{ binding_json: binding }] as Row[], rowCount: 1 };
    },
    transaction: async (work) => {
      const result = await work(sql);
      completedTransactions += 1;
      return result;
    },
  };
  await expect(
    new PostgresAflTradePrivateValuationCaptureBindingRepository(sql).accept({
      request: binding.content.request,
      claim: { claimId: binding.content.dispatchClaimId, leaseToken: '9'.repeat(64) },
      normalizationRunId: binding.content.normalizationRunId,
    })
  ).rejects.toThrow('selected capture authority');
  expect(completedTransactions).toBe(0);
});

it('parses explicitly source-first role custody without coercing a legacy binding', () => {
  const binding = sourceFirstBinding();
  expect(parseAflTradePrivateValuationCaptureBinding(binding)).toEqual(binding);
  const changed = {
    ...binding.content,
    schemaVersion: 'afl-trade-private-valuation-capture-binding/v2',
  };
  expect(() =>
    parseAflTradePrivateValuationCaptureBinding({
      bindingId: createAflTradeContentAddress('private-valuation-capture-binding', changed),
      content: changed,
    })
  ).toThrow();
});

it('permits explicitly selected source-first primary custody without calling it supplemental admission', () => {
  const binding = parseAflTradePrivateValuationCaptureBinding(sourceFirstBinding('factual_input'));
  expect(binding.content).toMatchObject({
    schemaVersion: 'afl-trade-private-valuation-capture-binding/v3',
    authorityKind: 'source_first',
    sourceRole: 'factual_input',
  });
});

it('accepts source-first custody only through the explicit source-first repository operation', async () => {
  const binding = parseAflTradePrivateValuationCaptureBinding(sourceFirstBinding());
  if (binding.content.schemaVersion !== 'afl-trade-private-valuation-capture-binding/v3')
    throw new Error('Wrong fixture');
  let returned: unknown = binding;
  let completedTransactions = 0;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters?: readonly unknown[]) {
      if (!statement.startsWith('SET LOCAL')) {
        expect(statement).toContain(
          'accept_outcome_private_valuation_source_first_capture($1,$2,$3,$4,$5)'
        );
        expect(parameters).toEqual([
          binding.content.request.requestId,
          binding.content.dispatchClaimId,
          createHash('sha256').update('9'.repeat(64)).digest('hex'),
          'hpn_primary_player_stats',
          binding.content.normalizationRunId,
        ]);
      }
      const rows = statement.startsWith('SET LOCAL') ? [] : [{ binding_json: returned }];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: async (work) => {
      const result = await work(sql);
      completedTransactions += 1;
      return result;
    },
  };
  const request = {
    request: binding.content.request,
    claim: { claimId: binding.content.dispatchClaimId, leaseToken: '9'.repeat(64) },
    sourceRole: binding.content.sourceRole,
    normalizationRunId: binding.content.normalizationRunId,
  };
  const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
  await expect(repository.acceptSourceFirst(request)).resolves.toEqual(binding);
  const { authorityKind: _authorityKind, ...legacy } = binding.content;
  const content = { ...legacy, schemaVersion: 'afl-trade-private-valuation-capture-binding/v2' };
  returned = {
    bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
    content,
  };
  await expect(repository.acceptSourceFirst(request)).rejects.toThrow('source-first');
  expect(completedTransactions).toBe(1);
});

it('authenticates the exact supplemental receipt returned at the SQL boundary', async () => {
  let returned = createAflTradePrivateValuationSupplementalSourceAdmission(input);
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string, parameters?: readonly unknown[]) {
      if (!statement.startsWith('SET LOCAL')) {
        expect(statement).toContain('admit_outcome_private_valuation_supplemental_source(');
        expect(parameters).toEqual([
          input.requestId,
          `private-valuation-dispatch-claim:${'8'.repeat(64)}`,
          createHash('sha256').update('9'.repeat(64)).digest('hex'),
          input.sourceRole,
          input.primarySourceAdmissionId,
          input.captureBindingId,
          input.sourceCaptureId,
          input.normalizationRunId,
          input.factBatchId,
          input.factualRunId,
        ]);
      }
      const rows = statement.startsWith('SET LOCAL')
        ? []
        : [
            {
              admission_result: { state: 'admitted', admission: returned },
            },
          ];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    transaction: (work) => work(sql),
  };
  const request = {
    ...input,
    claim: {
      claimId: `private-valuation-dispatch-claim:${'8'.repeat(64)}`,
      leaseToken: '9'.repeat(64),
    },
  };
  const repository = new PostgresAflTradePrivateValuationSourceAdmission(sql);
  await expect(repository.admitSupplemental(request)).resolves.toEqual({
    state: 'admitted',
    admission: returned,
  });
  returned = createAflTradePrivateValuationSupplementalSourceAdmission({
    ...input,
    normalizationRunId: `provider-normalization-run:${'a'.repeat(64)}`,
  });
  await expect(repository.admitSupplemental(request)).rejects.toThrow('exact supplemental');
});

it('retains the existing HPN receipt family for exact source-first custody without relabelling primary admission', async () => {
  const binding = parseAflTradePrivateValuationCaptureBinding(sourceFirstBinding());
  const projectedFieldMapId = `hpn-pav-field-map:${'e'.repeat(64)}`;
  const admission = createAflTradePrivateValuationHpnSourceAdmission({
    requestId: binding.content.request.requestId,
    dispatchClaimId: binding.content.dispatchClaimId,
    attemptSequence: binding.content.attemptSequence,
    attemptNumber: binding.content.attemptNumber,
    sourceRole: 'hpn_primary_player_stats',
    captureBindingId: binding.bindingId,
    sourceCaptureId: binding.content.sourceCaptureId,
    normalizationRunId: binding.content.normalizationRunId,
    projectedFieldMapId,
    admittedAt: input.admittedAt,
  });
  let returned = admission;
  let completedTransactions = 0;
  const sql: AflOutcomeSqlClient = {
    async query<Row>(statement: string) {
      if (statement.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      expect(statement).toContain('admit_outcome_private_valuation_hpn_source(');
      return {
        rows: [{ admission_result: { state: 'admitted', admission: returned } }] as Row[],
        rowCount: 1,
      };
    },
    transaction: async (work) => {
      const result = await work(sql);
      completedTransactions += 1;
      return result;
    },
  };
  const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
  const command = {
    request: binding.content.request,
    claim: { claimId: binding.content.dispatchClaimId, leaseToken: '9'.repeat(64) },
    factualOutputId: `private-valuation-factual-output:${'f'.repeat(64)}`,
    binding,
    projectedFieldMapId,
  };
  await expect(repository.admitHpnSource(command)).resolves.toEqual({
    state: 'admitted',
    admission,
  });
  const {
    schemaVersion: _version,
    principalId: _principal,
    environment: _environment,
    publicationEligible: _eligible,
    publicationProhibited: _prohibited,
    limitation: _limitation,
    ...parents
  } = admission.content;
  returned = createAflTradePrivateValuationHpnSourceAdmission({
    ...parents,
    normalizationRunId: `provider-normalization-run:${'a'.repeat(64)}`,
  });
  await expect(repository.admitHpnSource(command)).rejects.toThrow('dispatch source custody');
  expect(completedTransactions).toBe(1);
});
