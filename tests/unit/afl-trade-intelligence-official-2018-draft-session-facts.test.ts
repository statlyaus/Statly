import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AFL_2018_SESSION_FACT_URLS,
  parseOfficialAflDraft2018SessionFacts,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2018SessionFacts';

const sha = (value: string) => value.repeat(64);

function parse(url: string, displayedDate: string, children: readonly string[]) {
  return parseOfficialAflDraft2018SessionFacts(
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
        parserVersion: 'official-afl-completed-draft-session/v7',
        fieldManifestSha256: sha('c'),
      },
    }
  );
}

describe('reviewed Official AFL 2018 partial draft-session facts', () => {
  it('keeps each article within its exact proof role', () => {
    const nightOne = parse(OFFICIAL_AFL_2018_SESSION_FACT_URLS.nightOne, '2018-11-22T08:05:00Z', [
      '<p>CARLTON has crowned Sam Walsh the new No.1 pick at the 2018 NAB AFL Draft, while Gold Coast selected next at Marvel Stadium on Thursday night.</p>',
    ]);
    const firstDayTwo = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.dayTwoFirst,
      '2018-11-28T00:34:00Z',
      [
        '<p>The rebounding defender Jez McLennan (No.23) had to wait until the first selection on day two.</p>',
        '<p>Gold Coast traded up to get the South Australian teenager.</p>',
      ]
    );
    const final = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.finalSelection,
      '2018-11-23T06:22:00Z',
      [
        '<h4>Racing royalty at the Dogs</h4>',
        '<p>It was almost missed, but with the final selection the Western Bulldogs rewarded hard-working Will Hayes via pick 78.</p>',
        '<h4>Live pick trading divides opinions</h4>',
        "<p>The first round on Thursday night saw Carlton's recruiting team selecting Sam Walsh with pick No.1. Once the second round got underway on Friday, trading increased.</p>",
      ]
    );
    const lessons = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.completedLessons,
      '2018-11-27T00:18:00Z',
      [
        '<h4>1. Pick 19 is arguably worth more than pick 18</h4>',
        "<p>From the completion of Thursday's first round to the start of the rest of the draft on Friday, clubs reassessed.</p>",
        '<h4>7. More live trades than predicted</h4>',
        '<p>Seventeen of 78 players taken in the National Draft were academy selections.</p>',
        '<h4>8. Recruiters need to bank their sleep</h4>',
        '<p>The introduction of a two-day draft presented opportunities.</p>',
      ]
    );
    const schedule = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.prospectiveSchedule,
      '2018-11-19T22:56:00Z',
      ['<p>THE AFL has confirmed the final order for the NAB AFL Draft on November 22 and 23.</p>']
    );

    expect(nightOne.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'draft_session_date',
    ]);
    expect(firstDayTwo.evidence[0]?.content.claim).toMatchObject({
      kind: 'draft_session_boundary',
      sessionOrdinal: 2,
      selectionNumber: 23,
    });
    expect(final.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'draft_session_boundary',
      'draft_session_completion',
      'draft_session_date',
      'draft_session_completion',
      'draft_session_boundary',
    ]);
    expect(lessons.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'draft_session_completion',
      'draft_session_completion',
      'draft_completed_total',
    ]);
    expect(schedule.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'draft_session_date',
      'draft_session_date',
    ]);
    expect(schedule.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.objectContaining({ claim: { kind: 'draft_session_completion' } }) }),
      ])
    );
  });

  it('fails closed when a scoped completion or boundary statement changes', () => {
    const parsed = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.dayTwoFirst,
      '2018-11-28T00:34:00Z',
      ['<p>Jez McLennan was selected by Gold Coast with pick 23.</p>']
    );
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues).toHaveLength(1);
  });

  it('fails closed when reviewed statements are displaced from their scoped sections', () => {
    const parsed = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.finalSelection,
      '2018-11-23T06:22:00Z',
      [
        '<h4>Different section</h4>',
        '<p>With the final selection the Western Bulldogs rewarded hard-working Will Hayes via pick 78.</p>',
        '<h4>Racing royalty at the Dogs</h4>',
        '<p>This paragraph no longer contains the terminal selection.</p>',
        '<h4>Live pick trading divides opinions</h4>',
        "<p>The first round on Thursday night saw Carlton's recruiting team selecting Sam Walsh with pick No.1. Once the second round got underway on Friday, trading increased.</p>",
      ]
    );
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues).toHaveLength(1);
  });

  it('fails closed when an unscoped statement is duplicated', () => {
    const paragraph =
      '<p>THE AFL has confirmed the final order for the NAB AFL Draft on November 22 and 23.</p>';
    const parsed = parse(
      OFFICIAL_AFL_2018_SESSION_FACT_URLS.prospectiveSchedule,
      '2018-11-19T22:56:00Z',
      [paragraph, paragraph]
    );
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues).toHaveLength(1);
  });
});
