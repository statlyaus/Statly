import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AFL_2017_SESSION_FACT_URLS,
  parseOfficialAflDraft2017SessionFacts,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2017SessionFacts';

const sha = (value: string) => value.repeat(64);

function parse(url: string, displayedDate: string, children: readonly string[]) {
  return parseOfficialAflDraft2017SessionFacts(
    `<time class="article-date-decoy" datetime="2000-01-01T00:00:00Z"></time>
     <div class="article__date"><time datetime="${displayedDate}"></time></div>
     <div class="article-body">${children.join('')}</div>`,
    {
      capture: {
        captureId: `source-capture:${sha('a')}`,
        artifactId: `artifact:${sha('b')}`,
        contentSha256: sha('b'),
        mediaType: 'text/html',
        sourceUrl: url,
        capturedAt: '2026-09-11T00:00:00.000Z',
        effectiveAt: new Date(displayedDate).toISOString(),
        parserVersion: 'official-afl-completed-draft-session/v8',
        fieldManifestSha256: sha('c'),
      },
    }
  );
}

const validWrapChildren = [
  '<p>THE BRISBANE Lions have crowned Western Jets powerhouse Cameron Rayner as the No.1 pick of the 2017 NAB AFL Draft in a night of surprises.</p>',
  '<p>The under-18 All Australian said it was a big honour to be named the No.1 pick, just after 7pm AEDT at the Sydney Showground on Friday night.</p>',
  '<p>Delisted Hawk Billy Hartung was also given a lifeline by North Melbourne, while former Gold Coast utility Jarrod Garlett joined Carlton with the last pick in the draft at No.78.</p>',
];

describe('reviewed Official AFL 2017 one-session draft facts', () => {
  it('keeps completed, total, and prospective articles within their exact proof roles', () => {
    const wrap = parse(
      OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedWrap,
      '2017-11-24T10:22:00Z',
      validWrapChildren
    );
    const total = parse(
      OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedTotal,
      '2017-11-24T22:00:00Z',
      ["<p>78 – 78 players were selected by clubs in this year's NAB AFL Draft.</p>"]
    );
    const schedule = parse(
      OFFICIAL_AFL_2017_SESSION_FACT_URLS.prospectiveSchedule,
      '2017-11-22T03:22:00Z',
      [
        '<p>BELOW is the final order of selection for the 2017 NAB AFL Draft following the trade period.</p>',
        '<p>The draft will be held in Sydney on Friday night from 6:30pm AEDT.</p>',
      ]
    );

    expect(wrap.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2017-11-24',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Cameron Rayner' },
        selectedByClub: { nativeId: null, recordedName: 'Brisbane Lions' },
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 78,
        player: { nativeId: null, recordedName: 'Jarrod Garlett' },
        selectedByClub: { nativeId: null, recordedName: 'Carlton' },
      },
    ]);
    expect(total.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'draft_completed_total',
        draftYear: 2017,
        draftType: 'national',
        selectionCount: 78,
      },
    ]);
    expect(schedule.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2017-11-24',
      },
    ]);
  });

  it('fails closed when a boundary player, club, or number changes', () => {
    const html = validWrapChildren.join('');
    for (const changed of [
      html.replace('Cameron Rayner', 'Changed Player'),
      html.replace('BRISBANE Lions', 'CHANGED CLUB'),
      html.replace('No.1 pick of the 2017', 'No.2 pick of the 2017'),
      html.replace('Jarrod Garlett', 'Changed Player'),
      html.replace('joined Carlton', 'joined Essendon'),
      html.replace('No.78', 'No.77'),
    ]) {
      const parsed = parse(
        OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedWrap,
        '2017-11-24T10:22:00Z',
        [changed]
      );
      expect(parsed.evidence).toEqual([]);
      expect(parsed.issues).toHaveLength(1);
    }
  });

  it('fails closed when the completed total changes or duplicates', () => {
    const paragraph = "<p>78 – 78 players were selected by clubs in this year's NAB AFL Draft.</p>";
    for (const children of [[paragraph, paragraph], ["<p>77 players were selected by clubs in this year's NAB AFL Draft.</p>"]]) {
      const parsed = parse(
        OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedTotal,
        '2017-11-24T22:00:00Z',
        children
      );
      expect(parsed.evidence).toEqual([]);
      expect(parsed.issues).toHaveLength(1);
    }
  });

  it('fails closed for the wrong URL or displayed date', () => {
    expect(
      parse('https://www.afl.com.au/news/1/not-reviewed', '2017-11-24T10:22:00Z', validWrapChildren)
        .evidence
    ).toEqual([]);
    expect(
      parse(
        OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedWrap,
        '2017-11-25T10:22:00Z',
        validWrapChildren
      ).evidence
    ).toEqual([]);
  });

  it('fails closed for duplicated structure, missing statements, or text outside the article body', () => {
    const validBody = `<div class="article-body">${validWrapChildren.join('')}</div>`;
    const validDate = '<div class="article__date"><time datetime="2017-11-24T10:22:00Z"></time></div>';
    const capture = {
      captureId: `source-capture:${sha('a')}`,
      artifactId: `artifact:${sha('b')}`,
      contentSha256: sha('b'),
      mediaType: 'text/html' as const,
      sourceUrl: OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedWrap,
      capturedAt: '2026-09-11T00:00:00.000Z',
      effectiveAt: '2017-11-24T10:22:00.000Z',
      parserVersion: 'official-afl-completed-draft-session/v8',
      fieldManifestSha256: sha('c'),
    };
    const invalidPages = [
      validDate + validBody + validBody,
      validDate + validDate + validBody,
      validDate + `<p>${validWrapChildren[0]}</p>` + '<div class="article-body"></div>',
      validDate +
        `<div class="article-body">${validWrapChildren[0]?.replace('Cameron Rayner', 'Cameron</p><p>Rayner')}${validWrapChildren.slice(1).join('')}</div>`,
      validDate + `<div class="article-body">${validWrapChildren.slice(0, 2).join('')}</div>`,
    ];
    for (const html of invalidPages) {
      const parsed = parseOfficialAflDraft2017SessionFacts(html, { capture });
      expect(parsed.evidence).toEqual([]);
      expect(parsed.issues).toHaveLength(1);
    }
  });

  it('does not treat prospective schedule evidence as completion or membership', () => {
    const parsed = parse(
      OFFICIAL_AFL_2017_SESSION_FACT_URLS.prospectiveSchedule,
      '2017-11-22T03:22:00Z',
      [
        '<p>BELOW is the final order of selection for the 2017 NAB AFL Draft following the trade period.</p>',
        '<p>The draft will be held in Sydney on Friday night from 6:30pm AEDT.</p>',
      ]
    );
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.content.claim.kind).toBe('draft_session_date');
  });
});
