import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FootywireInjuryListParseError,
  fetchFootywireInjuryList,
  normalizeReturnTimeframe,
  parseFootywireInjuryList,
} from './footywireInjuryList';
import { clubTable, injuryListPage as page, playerRow } from './__fixtures__/footywireHtml';
import { FOOTYWIRE_INJURY_LIST_URL } from './injuryListConstants';

const fixture = readFileSync(
  join(process.cwd(), 'src/server/injuries/__fixtures__/footywire-injury-list.html'),
  'utf8'
);

describe('normalizeReturnTimeframe', () => {
  const none = { etaWeeksMin: null, etaWeeksMax: null, etaDaysMin: null, etaDaysMax: null };

  it('maps fixed labels', () => {
    expect(normalizeReturnTimeframe('Test')).toEqual({ status: 'TEST', ...none });
    expect(normalizeReturnTimeframe('TBC')).toEqual({ status: 'TBC', ...none });
    expect(normalizeReturnTimeframe('To be confirmed')).toEqual({ status: 'TBC', ...none });
    expect(normalizeReturnTimeframe('Season')).toEqual({ status: 'SEASON', ...none });
    expect(normalizeReturnTimeframe('Out for season')).toEqual({ status: 'SEASON', ...none });
    expect(normalizeReturnTimeframe('Concussion protocols')).toEqual({
      status: 'PROTOCOLS',
      ...none,
    });
  });

  it('reads week and day estimates', () => {
    expect(normalizeReturnTimeframe('2-3 weeks')).toEqual({
      ...none,
      status: 'WEEKS',
      etaWeeksMin: 2,
      etaWeeksMax: 3,
    });
    expect(normalizeReturnTimeframe('4+ weeks')).toEqual({
      ...none,
      status: 'WEEKS',
      etaWeeksMin: 4,
    });
    expect(normalizeReturnTimeframe('1 week')).toEqual({
      ...none,
      status: 'WEEKS',
      etaWeeksMin: 1,
      etaWeeksMax: 1,
    });
    expect(normalizeReturnTimeframe('0 weeks')).toEqual({
      ...none,
      status: 'WEEKS',
      etaWeeksMin: 1,
      etaWeeksMax: 0,
    });
    expect(normalizeReturnTimeframe('5-10 days')).toEqual({
      ...none,
      status: 'DAYS',
      etaDaysMin: 5,
      etaDaysMax: 10,
    });
    expect(normalizeReturnTimeframe('3+ days')).toEqual({ ...none, status: 'DAYS', etaDaysMin: 3 });
    expect(normalizeReturnTimeframe('7 days')).toEqual({
      ...none,
      status: 'DAYS',
      etaDaysMin: 7,
      etaDaysMax: 7,
    });
  });

  it('leaves anything else unknown', () => {
    expect(normalizeReturnTimeframe('Indefinite')).toEqual({ status: 'UNKNOWN', ...none });
    expect(normalizeReturnTimeframe('  ')).toEqual({ status: 'UNKNOWN', ...none });
  });
});

describe('parseFootywireInjuryList', () => {
  it('parses every row of the live page fixture', () => {
    const rows = parseFootywireInjuryList(fixture);

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.clubName)).toEqual([
      ...Array(5).fill('Brisbane Lions'),
      ...Array(3).fill('Fremantle Dockers'),
    ]);
    expect(rows[1]).toEqual({
      clubName: 'Brisbane Lions',
      sourceKey: 'pp-brisbane-lions--jack-payne',
      playerName: 'Jack Payne',
      injuryRaw: 'Knee',
      returnRaw: 'Season',
      status: 'SEASON',
      etaWeeksMin: null,
      etaWeeksMax: null,
      etaDaysMin: null,
      etaDaysMax: null,
    });
    expect(rows.find((row) => row.playerName === 'Noah Answerth')).toMatchObject({
      sourceKey: 'pp-brisbane-lions--noah-answerth',
      injuryRaw: 'Ankle',
      status: 'TEST',
    });
    expect(rows.find((row) => row.playerName === 'Ollie Murphy')).toMatchObject({
      injuryRaw: 'Leg/Calf',
      status: 'SEASON',
    });
    expect(rows.find((row) => row.playerName === 'Sam Sturt')).toMatchObject({
      clubName: 'Fremantle Dockers',
      injuryRaw: 'Hamstring',
      status: 'TBC',
    });
  });

  it('rejects a page with no club tables', () => {
    expect(() => parseFootywireInjuryList('<html><body>Maintenance</body></html>')).toThrow(
      FootywireInjuryListParseError
    );
  });

  it('rejects a page whose club tables hold no rows at all', () => {
    const html = page(
      clubTable('Carlton (0 Players)', []),
      clubTable('Collingwood (0 Players)', [])
    );
    expect(() => parseFootywireInjuryList(html)).toThrow(FootywireInjuryListParseError);
    expect(() => parseFootywireInjuryList(html)).toThrow(/no rows/);
  });

  it('rejects a club whose rows disagree with its header count', () => {
    const html = page(
      clubTable('Carlton (2 Players)', [
        playerRow('/afl/footy/pp-carlton-blues--sam-walsh', 'Sam Walsh', 'Back', 'TBC'),
      ])
    );
    expect(() => parseFootywireInjuryList(html)).toThrow(/declares 2 players but has 1 rows/);
  });

  it('rejects an unrecognised club header', () => {
    expect(() => parseFootywireInjuryList(page(clubTable('Carlton', [])))).toThrow(
      FootywireInjuryListParseError
    );
  });

  it('rejects a row without a player link, injury or return', () => {
    const cases = [
      playerRow('/afl/footy/player-stats', 'Sam Walsh', 'Back', 'TBC'),
      playerRow('/afl/footy/pp-carlton-blues--sam-walsh', 'Sam Walsh', '', 'TBC'),
      playerRow('/afl/footy/pp-carlton-blues--sam-walsh', 'Sam Walsh', 'Back', ' '),
    ];
    for (const row of cases) {
      expect(() => parseFootywireInjuryList(page(clubTable('Carlton (1 Player)', [row])))).toThrow(
        /row is incomplete/
      );
    }
  });

  it('rejects a player listed twice', () => {
    const row = playerRow('/afl/footy/pp-carlton-blues--sam-walsh', 'Sam Walsh', 'Back', 'TBC');
    const html = page(
      clubTable('Carlton (1 Player)', [row]),
      clubTable('Carlton Blues (1 Player)', [row])
    );
    expect(() => parseFootywireInjuryList(html)).toThrow(/listed twice/);
  });
});

describe('fetchFootywireInjuryList', () => {
  it('fetches the list uncached with a timeout', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>', { status: 200 }));

    await expect(fetchFootywireInjuryList(fetchImpl)).resolves.toBe('<html></html>');

    expect(fetchImpl).toHaveBeenCalledWith(
      FOOTYWIRE_INJURY_LIST_URL,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
    );
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(fetchFootywireInjuryList(fetchImpl)).rejects.toThrow('HTTP 503');
  });
});
