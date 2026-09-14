import { describe, expect, it } from 'vitest';
import {
  parseOfficialAflDraftSession,
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { parseDraftguruNationalYearSelections } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';

const urls = [
  'https://www.afl.com.au/news/1257161/new-tiger-king-richmond-snares-powerful-mid-sam-lalor-at-no1/amp',
  'https://www.afl.com.au/news/1257674/afl-draft-night-two-tigers-hold-firm-to-pounce-on-199cm-forward-dogs-pick-twice/amp',
];
const capture = (night: number) => ({
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl: urls[night - 1]!,
  capturedAt: '2026-09-10T00:00:00.000Z',
  effectiveAt: '2024-11-21T00:00:00.000Z',
  parserVersion: 'official-afl-completed-draft-session/v1',
  fieldManifestSha256: 'c'.repeat(64),
});
const rows = (first: number, last: number) =>
  `<p>${Array.from({ length: last - first + 1 }, (_, i) => `${first + i}. Synthetic player (Synthetic club)`).join('<br>')}</p>`;
function page(night: number) {
  return `<div class="amp-article__date">Nov ${night === 1 ? 20 : 21}, 2024</div>
    <div class="article-body"><p>${
      night === 1
        ? "Selections completed in Wednesday night's opening round; the last pick was No.27."
        : 'The opening pick on night two was No.28 on Thursday night, making a total of 71 across the 2024 draft.'
    }</p>
    <h4>2024 Telstra AFL Draft – First Round</h4>${rows(1, 27)}
    ${night === 2 ? `<h4>Second Round</h4>${rows(28, 71)}` : ''}</div>`;
}
const urls2023 = [
  'https://www.afl.com.au/news/1065734/need-for-harley-reid-eagles-swoop-on-prodigious-midfielder-at-no1-afl-draft/amp',
  'https://www.afl.com.au/news/1066247/eagles-land-203cm-forward-to-open-night-two-lions-grab-goalkicker-afl-draft',
];
const capture2023 = (night: number) => ({
  ...capture(night),
  sourceUrl: urls2023[night - 1]!,
  parserVersion: 'official-afl-completed-draft-session/v2',
});
function page2023(night: number) {
  return `${night === 1 ? '<div class="amp-article__date">Nov 20, 2023</div>' : '<div class="article__date"><time datetime="2023-11-21T10:43:00Z"></time></div><div class="feature-video__publish-container"><time datetime="2023-10-06T02:56:00Z"></time></div>'}
    <div class="article-body"><p>${night === 1 ? 'The opening round saw 29 players find AFL homes on Monday night.' : 'The second round got underway at pick No.30 on Tuesday. In total, 64 players were selected across the two nights.'}</p>
    <h4>2023 AFL Draft - ${night === 1 ? 'First' : 'Second'} Round</h4>${night === 1 ? rows(1, 29) : rows(30, 44) + '<h4>Third Round</h4>' + rows(45, 64)}</div>`;
}
describe('bounded completed official draft sessions', () => {
  it('conserves the 2021 sessions using the exact second-night paragraph list', () => {
    const reports = [
      {
        url: 'https://www.afl.com.au/news/688959/the-horne-supremacy-north-melbourne-makes-jason-horne-francis-its-no1-pick-for-the-2021-nab-afl-draft',
        stamp: '2021-11-24T10:36:00Z',
        narrative:
          "The No.1 pick in Wednesday night's NAB AFL Draft. With the final selection of the first round, No.20, Brisbane added Kai Lohmann.",
        marker: '<h4>2021 NAB AFL Draft - First Round</h4>',
        first: 1,
        last: 20,
      },
      {
        url: 'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait',
        stamp: '2021-11-25T11:45:00Z',
        narrative:
          'NIGHT two of the NAB AFL Draft started with Fremantle snapping up West Australian slider Matthew Johnson and ended with Taj Woewodin becoming a Melbourne father-son selection. There were surprises as 65 players found their way on to AFL lists. Prose also says Arlo Draper at No.46.',
        marker: '<p><strong>NAB AFL DRAFT NIGHT TWO</strong></p>',
        first: 21,
        last: 65,
      },
    ];
    for (const [index, report] of reports.entries()) {
      const html = `<div class="article__date"><time datetime="${report.stamp}"></time></div><div class="article-body"><p>${report.narrative}</p>${report.marker}${rows(report.first, report.last)}</div>`;
      const input = { capture: { ...capture(1), sourceUrl: report.url } };
      const result = parseOfficialAflDraftSession(html, input);
      expect(result.issues).toEqual([]);
      expect(result.evidence[0]?.content.claim).toMatchObject({
        kind: 'draft_session',
        draftYear: 2021,
        officialName: '2021 NAB AFL Draft',
        eventDate: index === 0 ? '2021-11-24' : '2021-11-25',
        sessionOrdinal: index + 1,
        selectionNumbers: Array.from(
          { length: report.last - report.first + 1 },
          (_, i) => report.first + i
        ),
      });
      const corrupted = [
        html.replace(report.stamp, '2021-11-26T00:00:00Z'),
        html.replace(report.narrative, 'The draft is expected next week.'),
        html.replace(report.marker, ''),
        html.replace(report.marker, report.marker + report.marker),
        html.replace(rows(report.first, report.last), ''),
        html.replace(`${report.first}. Synthetic player (Synthetic club)<br>`, ''),
        html.replace(`${report.first + 1}. Synthetic player`, `${report.first}. Synthetic player`),
        html.replace(`${report.first}. Synthetic player (Synthetic club)`, 'Malformed selection'),
        ...(index === 1
          ? [html.replace(report.marker, '<h4>Unreviewed heading</h4>' + report.marker)]
          : []),
      ];
      for (const changed of corrupted) {
        const invalid = parseOfficialAflDraftSession(changed, input);
        expect(invalid.evidence).toEqual([]);
        expect(invalid.issues[0]?.code).toBe('invalid_draft_session');
      }
    }
  });
  it('conserves the 59 selections across the 2022 reports and rejects changed evidence', () => {
    const reports = [
      {
        url: 'https://www.afl.com.au/news/869842/giants-grab-prized-forward-at-no-1-dons-hold-firm-sa-gun-slips-to-10',
        date: '2022-11-28',
        html: `<div class="article__date"><time datetime="2022-11-28T10:30:00Z"></time></div>
          <div class="article-body"><p>The draft opened on Monday night.
          The Giants rounded out the first round with pick No.21.</p>
          <h4>2022 NAB AFL Draft – First Round</h4>${rows(1, 21)}</div>`,
        first: 1,
        last: 21,
      },
      {
        url: 'https://www.afl.com.au/news/870364/giants-nab-versatile-tall-with-pick-22-eagles-add-exciting-ruckman/amp',
        date: '2022-11-29',
        html: `<div class="amp-article__date">Nov 29, 2022</div>
          <div class="article-body"><p>The opening pick on night two was pick No.22.
          Kyle Marshall at No.59, which was the final pick in the draft.</p>
          <h4>NAB AFL DRAFT - Second round</h4>${rows(22, 38)}
          <h4>Third round</h4>${rows(39, 52)}<h4>Fourth round</h4>${rows(53, 59)}</div>`,
        first: 22,
        last: 59,
      },
    ];
    for (const [index, report] of reports.entries()) {
      const result = parseOfficialAflDraftSession(report.html, {
        capture: { ...capture(1), sourceUrl: report.url },
      });
      expect(result.issues).toEqual([]);
      expect(result.evidence[0]?.content.claim).toMatchObject({
        kind: 'draft_session',
        draftYear: 2022,
        eventDate: report.date,
        sessionOrdinal: index + 1,
        officialName: '2022 NAB AFL Draft',
        selectionNumbers: Array.from(
          { length: report.last - report.first + 1 },
          (_, i) => report.first + i
        ),
      });
      const changedReports = [
        report.html.replace(`${report.first}. Synthetic player (Synthetic club)<br>`, ''),
        report.html.replace(
          `${report.first + 1}. Synthetic player`,
          `${report.first}. Synthetic player`
        ),
        report.html.replace(
          `${report.first}. Synthetic player (Synthetic club)`,
          'Missing selection'
        ),
        report.html.replace(index === 0 ? '2022-11-28T10:30:00Z' : 'Nov 29, 2022', 'Wrong date'),
        report.html.replace(index === 0 ? 'Monday night' : 'night two', 'Unrelated narrative'),
        report.html.replace(index === 0 ? 'No.21' : 'No.59', 'Unknown final pick'),
        report.html.replace(index === 0 ? 'First Round' : 'Third round', 'Unreviewed section'),
      ];
      for (const html of changedReports) {
        expect(
          parseOfficialAflDraftSession(html, {
            capture: { ...capture(1), sourceUrl: report.url },
          }).evidence
        ).toEqual([]);
      }
      expect(
        parseOfficialAflDraftSession(report.html, {
          capture: {
            ...capture(1),
            parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
            sourceUrl:
              'https://www.afl.com.au/news/870365/draft-talking-points-swans-moves-dons-easy-path-corey-s-chance',
          },
        }).evidence
      ).toEqual([]);
    }
  });
  it('admits only the exact reviewed article/year/pathway and national year-page capabilities', () => {
    const request: IngestAflTradeExternalPageRequest = {
      ...capture(1),
      parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      environment: 'non_production',
      provider: 'official_afl',
      competition: 'AFLM',
      anchorSeasonYear: 2024,
      draftPathway: 'national',
      dataset: 'Synthetic completed draft session',
      datasetVersion: 'v1',
      accessMechanism: 'automated_web',
      capabilityId: 'official-afl-completed-draft-session',
      maximumBytes: 2097152,
    };
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    for (const change of [
      { parserVersion: 'official-afl-completed-draft-session/v1' },
      { anchorSeasonYear: 2025 },
      { sourceUrl: urls[0] + '?other=true' },
      { draftPathway: null },
      { provider: 'draftguru' as const },
    ]) {
      expect(() => validateAflTradeExternalCaptureScope({ ...request, ...change })).toThrow();
    }
    const national = {
      ...request,
      provider: 'draftguru' as const,
      capabilityId: 'draftguru-national-year-page',
      sourceUrl: 'https://www.draftguru.com.au/years/2024',
    };
    expect(() => validateAflTradeExternalCaptureScope(national)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...national, draftPathway: null })
    ).toThrow();
    const reviewed2017 = {
      ...request,
      anchorSeasonYear: 2017,
      effectiveAt: '2017-11-24T10:22:00.000Z',
      sourceUrl:
        'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call',
    };
    expect(() => validateAflTradeExternalCaptureScope(reviewed2017)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...reviewed2017, anchorSeasonYear: 2018 })
    ).toThrow();
  });
  it('dispatches a reviewed 2017 page through the public adapter', () => {
    const sourceUrl =
      'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call';
    const html = `<div class="article__date"><time datetime="2017-11-24T10:22:00Z"></time></div>
      <div class="article-body">
        <p>THE BRISBANE Lions have crowned Western Jets powerhouse Cameron Rayner as the No.1 pick of the 2017 NAB AFL Draft in a night of surprises.</p>
        <p>The under-18 All Australian said it was a big honour to be named the No.1 pick, just after 7pm AEDT at the Sydney Showground on Friday night.</p>
        <p>Delisted Hawk Billy Hartung was also given a lifeline by North Melbourne, while former Gold Coast utility Jarrod Garlett joined Carlton with the last pick in the draft at No.78.</p>
      </div>`;
    const parsed = parseOfficialAflDraftSession(html, {
      capture: { ...capture(1), sourceUrl, effectiveAt: '2017-11-24T10:22:00.000Z' },
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.evidence.map(({ content }) => content.claim.kind)).toEqual([
      'draft_session_date',
      'draft_session_completion',
      'draft_session_boundary',
      'draft_session_boundary',
    ]);
  });
  it('retains first-night membership and excludes the first-round recap on night two', () => {
    const first = parseOfficialAflDraftSession(page(1), { capture: capture(1) });
    const second = parseOfficialAflDraftSession(page(2), { capture: capture(2) });
    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(first.evidence[0]!.content.claim).toMatchObject({
      kind: 'draft_session',
      eventDate: '2024-11-20',
      sessionOrdinal: 1,
      officialName: '2024 Telstra AFL Draft',
    });
    expect(second.evidence[0]!.content.claim).toMatchObject({
      eventDate: '2024-11-21',
      sessionOrdinal: 2,
    });
    const claim = second.evidence[0]!.content.claim;
    if (claim.kind !== 'draft_session') throw new Error('Expected session');
    expect(claim.selectionNumbers).toHaveLength(44);
    expect(claim.selectionNumbers[0]).toBe(28);
    expect(claim.selectionNumbers.at(-1)).toBe(71);
  });
  it.each([
    page(2).replace('Nov 21, 2024', 'Nov 22, 2024'),
    page(2).replace('Thursday night', 'Friday night'),
    page(2).replace('30. Synthetic player (Synthetic club)<br>', ''),
    page(2).replace('30. Synthetic player', '29. Synthetic player'),
    page(2).replace('Second Round', 'Unknown section'),
  ])('rejects drift or incomplete/duplicate membership %#', (html) => {
    const parsed = parseOfficialAflDraftSession(html, { capture: capture(2) });
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
  it('does not turn the corroborating schedule into a completed session', () => {
    const parsed = parseOfficialAflDraftSession(page(1), {
      capture: {
        ...capture(1),
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
        sourceUrl:
          'https://www.afl.com.au/news/1110249/afl-confirms-dates-for-2024-free-agency-trade-and-draft-period',
      },
    });
    expect(parsed.evidence).toEqual([]);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
  it('retains both 2023 sessions when the second report has no first-round recap', () => {
    for (const night of [1, 2]) {
      const parsed = parseOfficialAflDraftSession(page2023(night), { capture: capture2023(night) });
      expect(parsed.issues).toEqual([]);
      expect(parsed.evidence[0]!.content.claim).toMatchObject({
        kind: 'draft_session',
        draftYear: 2023,
        eventDate: night === 1 ? '2023-11-20' : '2023-11-21',
        sessionOrdinal: night,
        officialName: '2023 AFL Draft',
        selectionNumbers: Array.from(
          { length: night === 1 ? 29 : 35 },
          (_, i) => (night === 1 ? 1 : 30) + i
        ),
      });
    }
  });
  it.each([
    page2023(2).replace('2023-11-21T10:43:00Z', '2023-11-22T10:43:00Z'),
    page2023(2).replace('on Tuesday', 'on Wednesday'),
    page2023(2).replace('30. Synthetic player (Synthetic club)<br>', ''),
    page2023(2).replace('Third Round', 'Second Round'),
    page2023(2).replace('class="article__date"', 'class="video-date"'),
  ])('rejects 2023 article-date, narrative or session coverage drift %#', (html) => {
    expect(parseOfficialAflDraftSession(html, { capture: capture2023(2) }).evidence).toEqual([]);
  });
  it('accounts for explicitly excluded Draftguru pathways and rejects unknown labels', () => {
    const row = (label: string, number: number) => `<tr><td class="draft">${label}</td>
      <td class="number">${number}</td><td class="player"><a href="/players/synthetic-player">Synthetic player</a></td>
      <td class="club"><a href="/clubs/synthetic-club">Synthetic club</a></td><td>Unrequested grade</td></tr>`;
    const html = `<table class="big-pick-movements"><tbody>${row('National', 1)}${row('Trade', 0)}${row('Rookie', 1)}</tbody></table>`;
    const input = {
      capture: { ...capture(1), sourceUrl: 'https://www.draftguru.com.au/years/2024' },
      draftYear: 2024,
    };
    const result = parseDraftguruNationalYearSelections(html, input);
    expect(result.evidence).toHaveLength(1);
    expect(result.issues).toEqual([]);
    expect(result.scopeSummary).toEqual({
      observedRows: 3,
      includedRows: 1,
      excludedByPathway: { Trade: 1, Rookie: 1 },
    });
    const unknown = parseDraftguruNationalYearSelections(
      html.replace('Rookie', 'Unreviewed category'),
      input
    );
    expect(unknown.evidence).toEqual([]);
    expect(unknown.issues.length).toBeGreaterThan(0);
    for (const malformed of ['1-invalid', '1.5', '01', '0', '-1']) {
      const invalid = parseDraftguruNationalYearSelections(
        html.replace('class="number">1', `class="number">${malformed}`),
        input
      );
      expect(invalid.evidence).toEqual([]);
      expect(invalid.issues.length).toBeGreaterThan(0);
    }
  });
});
