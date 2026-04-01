import { describe, expect, it } from 'vitest';

import { determineFootywireFixtureStatus, parseLiveScoreboard } from './footywireLive';

describe('determineFootywireFixtureStatus', () => {
  it('marks known live mids as in progress even when a stats link exists', () => {
    expect(
      determineFootywireFixtureStatus({
        footywireMid: '11412',
        resultText: '54-42',
        liveMatchMids: new Set(['11412']),
      })
    ).toBe('in_progress');
  });

  it('marks score links as final when they are not currently live', () => {
    expect(
      determineFootywireFixtureStatus({
        footywireMid: '11410',
        resultText: '75-71',
        liveMatchMids: new Set(['11412']),
      })
    ).toBe('final');
  });

  it('keeps matches without a stats link scheduled', () => {
    expect(
      determineFootywireFixtureStatus({
        footywireMid: undefined,
        resultText: undefined,
        liveMatchMids: new Set(['11412']),
      })
    ).toBe('scheduled');
  });
});

describe('parseLiveScoreboard', () => {
  it('extracts current, completed, and scheduled matches from the live scoreboard', () => {
    const parsed = parseLiveScoreboard(`
      <h2 class="livestats">Live Now</h2>
      <div id="liveNowDiv">
        <table class="livestats" cellspacing="0" cellpadding="2">
          <tr>
            <td class="ldrow" width="110"><a href="th-carlton-blues">Blues</a></td>
            <td class="bdrow" width="30">54</td>
          </tr>
          <tr>
            <td class="lnorm"><a href="th-richmond-tigers">Tigers</a></td>
            <td class="bnorm">42</td>
          </tr>
          <tr><td colspan="2" class="bdrow"><a href="live_stats?mid=11412">Live Stats</a></td></tr>
        </table>
      </div>
      <div id="completedMatchesDiv">
        <h2 class="livestats">2026 Round 1 Completed Matches</h2>
        <table class="livestats" cellspacing="0" cellpadding="2">
          <tr>
            <td class="ldrow" width="110"><a href="th-essendon-bombers">Bombers</a></td>
            <td class="bdrow" width="30">83</td>
          </tr>
          <tr>
            <td class="lnorm"><a href="th-hawthorn-hawks">Hawks</a></td>
            <td class="bnorm">145</td>
          </tr>
          <tr><td colspan="2" class="bdrow"><a href="ft_match_statistics?mid=11411">Stats</a></td></tr>
        </table>
      </div>
      <div id="upcomingMatchesDiv">
        <h2 class="livestats">2026 Round 1 Scheduled Matches</h2>
        <table class="livestats" cellspacing="0" cellpadding="2">
          <tr>
            <td class="ldrow" width="90"><a href="th-melbourne-demons">Demons</a></td>
            <td class="drow" width="50">3:15pm</td>
          </tr>
          <tr>
            <td class="lnorm"><a href="th-st-kilda-saints">Saints</a></td>
            <td class="norm"></td>
          </tr>
          <tr><td colspan="2" class="drow">Sun 15 Mar</td></tr>
        </table>
      </div>
    `);

    expect(parsed.liveMatches).toEqual([
      expect.objectContaining({
        season: 2026,
        roundNumber: 1,
        status: 'in_progress',
        homeTeam: 'Carlton',
        awayTeam: 'Richmond',
        footywireMid: '11412',
      }),
    ]);
    expect(parsed.completedMatches).toEqual([
      expect.objectContaining({
        season: 2026,
        roundNumber: 1,
        status: 'final',
        homeTeam: 'Essendon',
        awayTeam: 'Hawthorn',
        footywireMid: '11411',
      }),
    ]);
    expect(parsed.scheduledMatches).toEqual([
      expect.objectContaining({
        season: 2026,
        roundNumber: 1,
        status: 'scheduled',
        homeTeam: 'Melbourne',
        awayTeam: 'St Kilda',
      }),
    ]);
  });
});
