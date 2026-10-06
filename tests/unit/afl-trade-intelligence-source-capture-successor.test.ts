import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  compareSourceCaptureClaims,
  createSourceCaptureSuccessorRecord,
  describeSourceCaptureSuccessorDecision,
} from '@/server/aflTradeIntelligence/source/sourceCaptureSuccessor';

const digest = (value: string) => sha256AflTradeCanonicalJson({ fixture: value });

function batch(
  suffix: string,
  capturedAt: string,
  claims: AflTradeExternalEvidenceContent['claim'][],
  provider: AflTradeExternalEvidenceContent['provider'] = 'draftguru'
) {
  const contentSha256 = digest(suffix);
  const capture = {
    captureId: `source-capture:${digest(`capture-${suffix}`)}`,
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    mediaType: 'text/html',
    sourceUrl: `https://example.test/${provider}/2024/national`,
    capturedAt,
    effectiveAt: '2024-11-25T00:00:00.000Z',
    parserVersion: `${provider}/${suffix}`,
    fieldManifestSha256: digest('manifest'),
  };
  const evidence = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider,
      capture,
      // Ordinals and source keys differ between captures; they are not facts.
      sourceRow: { ordinal: index + 10, sourceKey: `${suffix}:${index}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence,
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

const selection = (
  selectionNumber: number,
  name: string
): AflTradeExternalEvidenceContent['claim'] => ({
  kind: 'draft_selection',
  draftYear: 2024,
  draftType: 'national',
  selectionNumber,
  roundNumber: 1,
  player: { nativeId: null, recordedName: name },
  selectedByClub: { nativeId: null, recordedName: 'Synthetic Club' },
});

const LOST = '2026-09-10T10:24:40.877Z';
const FRESH = '2026-10-06T01:00:00.000Z';

describe('source capture successor claims', () => {
  it('matches when every recorded claim reappears, whatever the capture details', () => {
    const lost = batch('lost', LOST, [selection(1, 'One'), selection(2, 'Two')]);
    const fresh = batch('fresh', FRESH, [selection(2, 'Two'), selection(1, 'One')]);
    expect(compareSourceCaptureClaims(lost, fresh)).toEqual({
      matches: true,
      lostClaims: 2,
      freshClaims: 2,
      missing: [],
      additional: 0,
    });
  });

  it('reports additional fresh claims without refusing', () => {
    const lost = batch('lost', LOST, [selection(1, 'One')]);
    const fresh = batch('fresh', FRESH, [selection(1, 'One'), selection(2, 'Two')]);
    expect(compareSourceCaptureClaims(lost, fresh)).toMatchObject({ matches: true, additional: 1 });
  });

  it('refuses a changed or missing claim and names it', () => {
    const lost = batch('lost', LOST, [selection(1, 'One'), selection(2, 'Two')]);
    const changed = batch('fresh', FRESH, [selection(1, 'One'), selection(2, 'Changed')]);
    const comparison = compareSourceCaptureClaims(lost, changed);
    expect(comparison.matches).toBe(false);
    expect(comparison.missing).toHaveLength(1);
    expect(comparison.missing[0]).toContain('"recordedName":"Two"');
    expect(() =>
      describeSourceCaptureSuccessorDecision({ kind: 'recaptured', comparison })
    ).toThrow(/refused/);
  });

  it('counts repeated claims, so one fresh claim cannot stand for two recorded ones', () => {
    const lost = batch('lost', LOST, [selection(1, 'One'), selection(1, 'One')]);
    const fresh = batch('fresh', FRESH, [selection(1, 'One')]);
    expect(compareSourceCaptureClaims(lost, fresh)).toMatchObject({ matches: false });
  });

  it('refuses a batch from another provider', () => {
    const lost = batch('lost', LOST, [selection(1, 'One')]);
    const fresh = batch('fresh', FRESH, [selection(1, 'One')], 'footywire');
    expect(() => compareSourceCaptureClaims(lost, fresh)).toThrow(/same provider/);
  });
});

describe('source capture successor record', () => {
  it('builds the exact content-addressed record for each kind', () => {
    const recaptured = createSourceCaptureSuccessorRecord({
      kind: 'recaptured',
      lostArtifactId: 'artifact:lost',
      successorCaptureId: 'source-capture:fresh',
      successorArtifactId: 'artifact:fresh',
      createdAt: FRESH,
    });
    expect(recaptured.record).toEqual({
      schemaVersion: 'afl-trade-source-capture-successor/v1',
      kind: 'recaptured',
      lostArtifactId: 'artifact:lost',
      successorCaptureId: 'source-capture:fresh',
      successorArtifactId: 'artifact:fresh',
      createdAt: FRESH,
    });
    expect(recaptured.successorId).toMatch(/^source-capture-successor:[0-9a-f]{64}$/);
    const omitted = createSourceCaptureSuccessorRecord({
      kind: 'omitted',
      lostArtifactId: 'artifact:lost',
      createdAt: FRESH,
    });
    expect(omitted.record).toMatchObject({ successorCaptureId: null, successorArtifactId: null });
    expect(omitted.successorId).not.toBe(recaptured.successorId);
  });

  it('refuses a successor citing the lost bytes or an imprecise instant', () => {
    expect(() =>
      createSourceCaptureSuccessorRecord({
        kind: 'recaptured',
        lostArtifactId: 'artifact:same',
        successorCaptureId: 'source-capture:fresh',
        successorArtifactId: 'artifact:same',
        createdAt: FRESH,
      })
    ).toThrow(/different bytes/);
    expect(() =>
      createSourceCaptureSuccessorRecord({
        kind: 'omitted',
        lostArtifactId: 'artifact:lost',
        createdAt: '2026-10-06',
      })
    ).toThrow(/millisecond/);
  });

  it('records the owner decision behind an omission', () => {
    expect(
      describeSourceCaptureSuccessorDecision({
        kind: 'omitted',
        ownerDecisionRef: 'statlyaus/Statly#742 (2026-10-05)',
      })
    ).toContain('statlyaus/Statly#742');
  });
});
