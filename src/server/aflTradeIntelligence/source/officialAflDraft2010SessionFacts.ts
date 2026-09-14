import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';
import { parseOfficialAflDraft2010ListFacts } from './officialAflDraft2010ListFacts';
export const OFFICIAL_AFL_2010_SESSION_SOURCES = {
  membership: {
    url: 'https://www.afl.com.au/news/469544/round-by-round-selections',
    time: '2010-11-23T04:41:00Z',
    digest: '465a95efa7f5a0229579e53c88caa70c7748b3fcd26d14dee828f26f2cb22adc',
  },
  polo: {
    url: 'https://www.afl.com.au/news/45435/polo-prepared-for-different-roles',
    time: '2010-11-24T04:44:00Z',
    digest: '7761591a68d1ee54ca19e41eb3dc8f2df83eee1867ef37d186c218a9bad93c23',
  },
  collingwood: {
    url: 'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are',
    time: '2010-11-18T08:55:00Z',
    digest: 'ab3910537274315ca30a768eed9f861f5f0b0647612706323b2eff077dd2cd9c',
  },
} as const;
const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
function parseNumberedMembership(bodyHtml: string) {
  const scope = { draftYear: 2010 as const, draftType: 'national' as const };
  const claims: AflTradeExternalEvidenceContent['claim'][] = [];
  const rows = bodyHtml
    .split(/<br\s*\/?\s*>/i)
    .map((fragment) => norm(load(fragment).text()))
    .filter((t) => /^\d+ /.test(t));
  if (rows.length !== 112 || rows.some((row, i) => Number(row.match(/^\d+/)![0]) !== i + 1))
    return null;
  for (const row of rows) {
    if (row.includes('(PR)') || /\bpass\b/i.test(row)) continue;
    const match = row.match(/^(\d+) (.+?) - (.+)$/);
    if (!match) continue; // Blank published slots remain absent, never inferred as passes.
    const recordedName = match[3]!.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (!recordedName) return null;
    claims.push({
      ...scope,
      kind: 'draft_completed_member_number',
      recordedName,
      selectionNumber: Number(match[1]),
    });
  }
  if (claims.length !== 77) return null;
  claims.push({
    ...scope,
    kind: 'draft_session_boundary',
    sessionOrdinal: 1,
    boundary: 'first',
    selectionNumber: 1,
    player: { nativeId: null, recordedName: 'David Swallow' },
    selectedByClub: { nativeId: null, recordedName: 'Gold Coast Suns' },
  });
  return claims;
}

/** Separate numbered-member facts retain each document's actual scope and spellings. */
export function parseOfficialAflDraft2010SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
) {
  const fail = () => ({
    evidence: [],
    issues: [
      {
        code: 'invalid_draft_session' as const,
        sourceKey: input.capture.sourceUrl,
        detail: 'Reviewed2010 membership source, body or date changed.',
      },
    ],
  });
  const entry = Object.entries(OFFICIAL_AFL_2010_SESSION_SOURCES).find(
    ([, s]) => s.url === input.capture.sourceUrl
  );
  if (!entry) return fail();
  const [key, source] = entry,
    $ = load(html),
    body = $('.article-body'),
    dates = $('.article__date > time'),
    text = norm(body.text());
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== source.time ||
    createHash('sha256').update(text).digest('hex') !== source.digest
  )
    return fail();
  const scope = { draftYear: 2010 as const, draftType: 'national' as const };
  const claims: AflTradeExternalEvidenceContent['claim'][] = [];
  if (key === 'membership') {
    const membership = parseNumberedMembership(body.html()!);
    if (!membership) return fail();
    claims.push(...membership);
  } else if (key === 'polo') {
    if (!text.includes('Dean Polo') || !text.includes('103rd selection')) return fail();
    claims.push({
      ...scope,
      kind: 'draft_completed_member_number',
      recordedName: 'Dean Polo',
      selectionNumber: 103,
    });
  } else {
    if (
      !text.includes('2010 AFL Draft held on the Gold Coast on Thursday 18 November.') ||
      !text.includes('Pick 104 (6th round) Tom Young')
    )
      return fail();
    claims.push(
      {
        ...scope,
        kind: 'draft_completed_member_number',
        recordedName: 'Tom Young',
        selectionNumber: 104,
      },
      { ...scope, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2010-11-18' },
      { ...scope, kind: 'draft_session_completion', sessionOrdinal: 1 }
    );
    claims.push({
      ...scope,
      kind: 'draft_session_member_identity',
      sessionOrdinal: 1,
      selectionNumber: 104,
      player: { nativeId: null, recordedName: 'Tom Young' },
      selectedByClub: { nativeId: null, recordedName: 'Collingwood' },
    });
    // This report establishes Young at104, not that104 is the global final selection.
    // Terminal status must be established by the complete cross-document population proof.
  }
  const evidence = claims.map((claim, i) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: 'afl-trade-external-evidence/v1',
      provider: 'official_afl',
      capture: input.capture,
      sourceRow: { ordinal: i + 2, sourceKey: `2010-national-${key}:${i + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  if (key === 'membership') {
    const populations = parseOfficialAflDraft2010ListFacts(html, input);
    if (populations.issues.length) return fail();
    evidence.unshift(...populations.evidence);
  }
  return { evidence, issues: [] };
}
