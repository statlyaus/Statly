import { describe, expect, it } from 'vitest';
import { resolveCompletedDraftMembership } from '@/server/aflTradeIntelligence/source/completedDraftMembership';

const fixture = () => ({
  draftYear: 2011,
  draftType: 'national',
  inventoryNumbers: [1, 71],
  roster: {
    kind: 'completed_draft_membership_roster' as const,
    draftYear: 2011,
    draftType: 'national',
    evidenceId: 'roster-evidence',
    captureId: 'roster-capture',
    artifactId: 'roster-artifact',
    documentId: 'official_afl:news:506746',
    members: [
      { recordedName: 'Jonathon Patton', selectionNumber: 1 },
      { recordedName: 'Cameron Sutcliffe', selectionNumber: 72 },
    ],
  },
  bindings: [
    {
      kind: 'completed_draft_member_number' as const,
      draftYear: 2011,
      draftType: 'national',
      evidenceId: 'club-evidence',
      captureId: 'club-capture',
      artifactId: 'club-artifact',
      documentId: 'official_afl:news:75034',
      recordedName: 'Cameron Sutcliffe',
      selectionNumber: 71,
    },
  ],
});
describe('reviewed source number discrepancy', () => {
  it('keeps both immutable source values and their evidence references', () => {
    const input = fixture(),
      before = structuredClone(input);
    expect(resolveCompletedDraftMembership(input)).toEqual({
      schemaVersion: 'afl-trade-completed-draft-membership/v1',
      selectionNumbers: [1, 71],
      evidenceIds: ['club-evidence', 'roster-evidence'],
    });
    expect(input).toEqual(before);
  });
  it.each([
    'year',
    'type',
    'roster-document',
    'binding-document',
    'name',
    'reported-number',
    'selected-number',
    'capture',
    'artifact',
    'evidence',
    'missing',
    'duplicate',
    'raw-duplicate',
    'inventory',
  ] as const)('rejects unsupported %s changes', (mode) => {
    const input = fixture();
    if (mode === 'year') {
      input.draftYear = 2012;
      input.roster.draftYear = 2012;
      input.bindings[0]!.draftYear = 2012;
    }
    if (mode === 'type') {
      input.draftType = 'rookie';
      input.roster.draftType = 'rookie';
      input.bindings[0]!.draftType = 'rookie';
    }
    if (mode === 'roster-document') input.roster.documentId = 'official_afl:news:75034';
    if (mode === 'binding-document') input.bindings[0]!.documentId = 'official_afl:news:unknown';
    if (mode === 'name') {
      input.roster.members[1]!.recordedName = 'Another Player';
      input.bindings[0]!.recordedName = 'Another Player';
    }
    if (mode === 'reported-number') input.roster.members[1]!.selectionNumber = 73;
    if (mode === 'selected-number') {
      input.bindings[0]!.selectionNumber = 70;
      input.inventoryNumbers = [1, 70];
    }
    if (mode === 'capture') input.bindings[0]!.captureId = input.roster.captureId;
    if (mode === 'artifact') input.bindings[0]!.artifactId = input.roster.artifactId;
    if (mode === 'evidence') input.bindings[0]!.evidenceId = input.roster.evidenceId;
    if (mode === 'missing') input.bindings = [];
    if (mode === 'duplicate') input.bindings.push({ ...input.bindings[0]!, evidenceId: 'another' });
    if (mode === 'raw-duplicate') {
      input.roster.members[0]!.selectionNumber = 72;
      input.inventoryNumbers = [71, 72];
    }
    if (mode === 'inventory') input.inventoryNumbers = [1, 72];
    expect(() => resolveCompletedDraftMembership(input)).toThrow();
  });
});
