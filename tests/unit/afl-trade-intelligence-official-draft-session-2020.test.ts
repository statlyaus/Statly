import { describe, expect, it } from 'vitest';
import { parseOfficialAflDraftSession } from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';

const capture = {
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl:
    'https://www.afl.com.au/news/528411/every-pick-every-player-check-out-who-your-club-drafted',
  capturedAt: '2026-09-11T00:00:00.000Z',
  effectiveAt: '2020-12-09T00:00:00.000Z',
  parserVersion: 'official-afl-completed-draft-session/v5',
  fieldManifestSha256: 'c'.repeat(64),
};
const selection = (n: number) =>
  `<p><strong>${n}${n === 28 ? ':' : '.'} Synthetic Club: ${n === 19 ? 'Finlay</strong><strong>Macrae' : [21, 22, 27].includes(n) ? '</strong><strong>Synthetic Player' : 'Synthetic Player'}${n === 44 ? '<br>' : ''}</strong><br>DOB: unknown<br>Predicted draft range: 1–3</p>`;
const html = `<div class="article__date"><time datetime="2020-12-09T12:30:00Z"></time></div><div class="article-body"><p>JAMARRA Ugle-Hagan is the No.1 selection in the 2020 NAB AFL Draft.</p><p>Take a look at every pick in a draft full of twists and turns, trades and loads of Academy bids.</p>${Array.from({ length: 59 }, (_, i) => selection(i + 1)).join('')}</div>`;

describe('reviewed 2020 completed national draft report', () => {
  it('retains only complete session membership, including the exact punctuation and line-break exceptions', () => {
    const parsed = parseOfficialAflDraftSession(html, { capture });
    expect(parsed.issues).toEqual([]);
    expect(parsed.evidence[0]?.content.claim).toEqual({
      kind: 'draft_session',
      draftYear: 2020,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2020-12-09',
      officialName: '2020 NAB AFL Draft',
      selectionNumbers: Array.from({ length: 59 }, (_, i) => i + 1),
    });
  });
  it.each([
    html.replace('2020-12-09T12:30:00Z', '2020-12-10T12:30:00Z'),
    html.replace('No.1 selection in the 2020 NAB AFL Draft', 'prospective selection next week'),
    html.replace('every pick in a draft', 'a projected draft range'),
    html.replace(selection(17), ''),
    html.replace(selection(17), selection(18)),
    html.replace(selection(17) + selection(18), selection(18) + selection(17)),
    html.replace('28: Synthetic', '28. Synthetic'),
    html.replace('27. Synthetic', '27: Synthetic'),
    html.replace('59. Synthetic Club: Synthetic Player', '59. Missing club separator'),
    html.replace(
      selection(17),
      selection(17).replace('<strong>', '<strong>17. Duplicate: Player</strong><strong>')
    ),
    html.replace(selection(17), selection(17).replace('<p>', '<p><span>Unreviewed prefix</span>')),
    html.replace('class="article-body">', 'class="article-body"><h4>Unreviewed section</h4>'),
    html.replace('Finlay</strong><strong>Macrae', 'Finlay</strong><strong>20. Another: Player'),
    html.replace('Finlay</strong><strong>Macrae', 'Finlay</strong><span>gap</span><strong>Macrae'),
    html.replace('Finlay</strong><strong>Macrae', 'Finlay</strong><strong>'),
    html.replace(
      'Finlay</strong><strong>Macrae',
      'Finlay</strong><strong>Macrae</strong><strong>extra'
    ),
    html.replace(
      '17. Synthetic Club: Synthetic Player',
      '17. Synthetic Club:</strong><strong>Synthetic Player'
    ),
  ])('rejects contextual or selection-layout drift %#', (changed) => {
    const parsed = parseOfficialAflDraftSession(changed, { capture });
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues[0]?.code).toBe('invalid_draft_session');
  });
});
