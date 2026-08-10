import { describe, expect, it, vi } from 'vitest';

import {
  buildFootywireDraftCrawlPlan,
  captureFootywireDraftSource,
  parseFootywireDraftSelections,
} from '@/server/aflTradeIntelligence/source/footywireDraftSourceAdapter';

const digest = (character: string) => character.repeat(64);
const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=N',
  capturedAt: '2026-08-09T01:00:00.000Z',
  effectiveAt: '2025-11-20T00:00:00.000Z',
  parserVersion: 'footywire-draft-parser/v1',
  fieldManifestSha256: digest('3'),
} as const;

const nationalDraftHtml = `
  <table width="688">
    <tr>
      <td class="bnorm">Round</td><td class="bnorm">Pick</td>
      <td class="lbnorm">Drafted By</td><td class="lbnorm">Player</td>
      <td class="lbnorm">Current Team</td><td class="bnorm">Games Since Drafted</td>
    </tr>
    <tr class="darkcolor">
      <td align="center">1</td><td align="center">14</td>
      <td><a href="th-sydney-swans">Sydney</a></td>
      <td><a href="pp-sydney-swans--harry-kyle">Harry Kyle</a><span title="Academy">A</span></td>
      <td><a href="th-greater-western-sydney-giants">Greater Western Sydney</a></td>
      <td align="center">7</td>
    </tr>
    <tr class="lightcolor">
      <td align="center">1</td><td align="center">19</td>
      <td><a href="th-west-coast-eagles">West Coast</a></td>
      <td><a href="pp-west-coast-eagles--josh-lindsay">Josh Lindsay</a></td>
      <td><a href="th-west-coast-eagles">West Coast</a></td>
      <td align="center">12</td>
    </tr>
  </table>`;

describe('Footywire full-draft source adapter', () => {
  it('plans each draft pathway as a separate bounded source URL', () => {
    expect(
      buildFootywireDraftCrawlPlan({
        fromYear: 2024,
        throughYear: 2025,
        draftTypes: ['national', 'rookie', 'pre_season', 'mid_season'],
      })
    ).toEqual([
      'https://www.footywire.com/afl/footy/ft_drafts?year=2024&t=N',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2024&t=R',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2024&t=P',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2024&t=M',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=N',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=R',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=P',
      'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=M',
    ]);
    expect(() =>
      buildFootywireDraftCrawlPlan({
        fromYear: 2025,
        throughYear: 2024,
        draftTypes: ['national'],
      })
    ).toThrow();
    expect(() =>
      buildFootywireDraftCrawlPlan({
        fromYear: 1896,
        throughYear: 2025,
        draftTypes: ['national'],
      })
    ).toThrow();
  });

  it('parses exact final selections and provider-native link identities', () => {
    const result = parseFootywireDraftSelections(nationalDraftHtml, { capture });

    expect(result.issues).toEqual([]);
    expect(result.evidence.map((row) => row.content.claim)).toEqual([
      {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        player: { nativeId: 'pp-sydney-swans--harry-kyle', recordedName: 'Harry Kyle' },
        selectedByClub: { nativeId: 'th-sydney-swans', recordedName: 'Sydney' },
      },
      {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 19,
        roundNumber: 1,
        player: { nativeId: 'pp-west-coast-eagles--josh-lindsay', recordedName: 'Josh Lindsay' },
        selectedByClub: { nativeId: 'th-west-coast-eagles', recordedName: 'West Coast' },
      },
    ]);
  });

  it('does not import current club, games or player annotations as selection facts', () => {
    const result = parseFootywireDraftSelections(nationalDraftHtml, { capture });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('Greater Western Sydney');
    expect(serialized).not.toContain('games');
    expect(serialized).not.toContain('Academy');
    expect(serialized).not.toContain('title');
  });

  it('quarantines malformed draft rows rather than guessing selection identity', () => {
    const result = parseFootywireDraftSelections(
      nationalDraftHtml.replace('>19</td>', '>Pick nineteen</td>'),
      { capture }
    );

    expect(result.evidence).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid_selection_row', sourceKey: 'row:2' }),
    ]);
  });

  it('derives the draft pathway from the exact captured query and rejects query drift', () => {
    const rookie = parseFootywireDraftSelections(nationalDraftHtml, {
      capture: { ...capture, sourceUrl: capture.sourceUrl.replace('t=N', 't=R') },
    });
    expect(rookie.evidence[0]?.content.claim).toEqual(
      expect.objectContaining({ kind: 'draft_selection', draftType: 'rookie' })
    );
    expect(() =>
      parseFootywireDraftSelections(nationalDraftHtml, {
        capture: { ...capture, sourceUrl: capture.sourceUrl.replace('t=N', 't=X') },
      })
    ).toThrow(/pathway/i);
  });

  it('enforces the exact host, query, content type and byte bound during capture', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"same"' } }))
      .mockResolvedValueOnce(
        new Response('not html', { status: 200, headers: { 'content-type': 'text/plain' } })
      )
      .mockResolvedValueOnce(
        new Response('x'.repeat(21), {
          status: 200,
          headers: { 'content-type': 'text/html', 'content-length': '21' },
        })
      );

    await expect(
      captureFootywireDraftSource({
        url: capture.sourceUrl,
        fetchImpl,
        maximumBytes: 20,
        validators: { eTag: '"same"', lastModified: null },
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'not_modified' }));
    await expect(
      captureFootywireDraftSource({
        url: capture.sourceUrl,
        fetchImpl,
        maximumBytes: 20,
        validators: null,
      })
    ).rejects.toThrow(/content type/i);
    await expect(
      captureFootywireDraftSource({
        url: capture.sourceUrl,
        fetchImpl,
        maximumBytes: 20,
        validators: null,
      })
    ).rejects.toThrow(/maximum/i);
    await expect(
      captureFootywireDraftSource({
        url: 'https://example.com/afl/footy/ft_drafts?year=2025&t=N',
        fetchImpl,
        maximumBytes: 20,
        validators: null,
      })
    ).rejects.toThrow(/Footywire/i);
  });
});
