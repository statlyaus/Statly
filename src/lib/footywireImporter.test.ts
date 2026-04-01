import { describe, expect, it } from 'vitest';

import { vi } from 'vitest';

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

import { parseFixtureRows, parseFootywireMatchHtml } from './footywireImporter';

describe('parseFixtureRows', () => {
  it('upgrades scheduled fixture rows to in-progress when live match metadata is available', () => {
    const rows = parseFixtureRows(
      `
        <table>
          <tr><td><a name="round_1"></a></td></tr>
          <tr>
            <td>Sat 14 Mar 1:15pm</td>
            <td><a href="th-western-bulldogs">Bulldogs</a> v <a href="th-greater-western-sydney-giants">Giants</a></td>
            <td>Marvel Stadium</td>
            <td>0</td>
            <td></td>
          </tr>
        </table>
      `,
      2026,
      new Set([1]),
      [
        {
          season: 2026,
          roundNumber: 1,
          homeTeam: 'Western Bulldogs',
          awayTeam: 'GWS',
          footywireMid: '11412',
          status: 'in_progress',
        },
      ]
    );

    expect(rows).toEqual([
      expect.objectContaining({
        season: 2026,
        roundNumber: 1,
        homeTeam: 'Western Bulldogs',
        awayTeam: 'GWS',
        footywireMid: '11412',
        status: 'in_progress',
      }),
    ]);
  });
});

describe('parseFootywireMatchHtml', () => {
  it('parses in-progress live_stats pages into live player stats', () => {
    const result = parseFootywireMatchHtml(
      `
        <h2 class="livestats">2026 Round 1 Bulldogs v Giants at Marvel Stadium</h2>
        <table border="0" cellspacing="0" cellpadding="0" width="432">
          <tr><td height="28" align="center" colspan="3" class="tbtitle">2nd Quarter 2:48 Scores</td></tr>
          <tr>
            <td rowspan="1" class="tabbdr" style="width:1px"></td>
            <td>
              <table border="0" cellspacing="0" cellpadding="3" width="430">
                <tr><td height="28" width="170" class="lbnorm">Team</td><td width="45" class="bnorm">Q1</td><td width="45" class="bnorm">Q2</td><td width="45" class="bnorm">Q3</td><td width="45" class="bnorm">Q4</td><td width="45" class="bnorm">Score</td></tr>
                <tr><td height="24" class="ldrow"><b><a href="th-western-bulldogs">Western Bulldogs</a></b></td><td class="drow">5.1</td><td class="drow">5.1</td><td class="drow">-</td><td class="drow">-</td><td class="drow">31</td></tr>
                <tr><td height="24" class="lnorm"><b><a href="th-greater-western-sydney-giants">GWS GIANTS</a></b></td><td class="norm">2.3</td><td class="norm">3.3</td><td class="norm">-</td><td class="norm">-</td><td class="norm">21</td></tr>
              </table>
            </td>
            <td rowspan="1" class="tabbdr" style="width:1px"></td>
          </tr>
        </table>
        <div id="team1Stats">
          <table border="0" cellspacing="0" cellpadding="0" width="690">
            <tr><td height="28" align="center" colspan="3" class="tbtitle">Western Bulldogs Statistics</td></tr>
            <tr><td rowspan="1" class="tabbdr" style="width:1px"></td><td>
              <table border="0" cellspacing="0" cellpadding="3" width="688">
                <tr>
                  <td class="bnorm">No</td><td width="144" class="lbnorm">&nbsp;Player</td><td width="32" class="bnorm">K</td><td width="32" class="bnorm">HB</td><td width="32" class="bnorm">D</td><td width="32" class="bnorm">M</td><td width="32" class="bnorm">G</td><td width="32" class="bnorm">B</td><td width="32" class="bnorm">T</td><td width="32" class="bnorm">HO</td><td width="32" class="bnorm">GA</td><td width="32" class="bnorm">I50</td><td width="32" class="bnorm">FF</td><td width="32" class="bnorm">FA</td><td width="32" class="bnorm">CL</td><td width="32" class="bnorm">CG</td><td width="32" class="bnorm">R50</td><td width="32" class="bnorm">AF</td><td width="32" class="bnorm">SC</td>
                </tr>
                <tr class="darkcolor">
                  <td class="statdata">4</td><td align="left" height="24">&nbsp;<a href="pp-western-bulldogs--marcus-bontempelli" nowrap>M Bontempelli</a></td><td class="statdata">8</td><td class="statdata">3</td><td class="statdata">11</td><td class="statdata">1</td><td class="statdata">2</td><td class="statdata">0</td><td class="statdata">1</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">4</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">2</td><td class="statdata">2</td><td class="statdata">0</td><td class="statdata">49</td><td class="statdata">46</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </div>
        <div id="team2Stats">
          <table border="0" cellspacing="0" cellpadding="0" width="690">
            <tr><td height="28" align="center" colspan="3" class="tbtitle">GWS GIANTS Statistics</td></tr>
            <tr><td rowspan="1" class="tabbdr" style="width:1px"></td><td>
              <table border="0" cellspacing="0" cellpadding="3" width="688">
                <tr>
                  <td class="bnorm">No</td><td width="144" class="lbnorm">&nbsp;Player</td><td width="32" class="bnorm">K</td><td width="32" class="bnorm">HB</td><td width="32" class="bnorm">D</td><td width="32" class="bnorm">M</td><td width="32" class="bnorm">G</td><td width="32" class="bnorm">B</td><td width="32" class="bnorm">T</td><td width="32" class="bnorm">HO</td><td width="32" class="bnorm">GA</td><td width="32" class="bnorm">I50</td><td width="32" class="bnorm">FF</td><td width="32" class="bnorm">FA</td><td width="32" class="bnorm">CL</td><td width="32" class="bnorm">CG</td><td width="32" class="bnorm">R50</td><td width="32" class="bnorm">AF</td><td width="32" class="bnorm">SC</td>
                </tr>
                <tr class="darkcolor">
                  <td class="statdata">17</td><td align="left" height="24">&nbsp;<a href="pp-greater-western-sydney-giants--finn-callaghan" nowrap>F Callaghan</a></td><td class="statdata">5</td><td class="statdata">4</td><td class="statdata">9</td><td class="statdata">1</td><td class="statdata">1</td><td class="statdata">0</td><td class="statdata">2</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">1</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">2</td><td class="statdata">1</td><td class="statdata">0</td><td class="statdata">40</td><td class="statdata">43</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </div>
      `,
      {
        season: 2026,
        roundNumber: 1,
        homeTeam: 'Western Bulldogs',
        awayTeam: 'GWS',
        dateText: 'Sat 14 Mar 1:15pm',
        venue: 'Marvel Stadium',
        footywireMid: '11412',
        status: 'in_progress',
      },
      new Map([
        ['marcus bontempelli|western bulldogs', { id: 'marcus_bontempelli', name: 'Marcus Bontempelli', team: 'Western Bulldogs', position: 'MID' }],
        ['finn callaghan|gws', { id: 'finn_callaghan', name: 'Finn Callaghan', team: 'GWS', position: 'MID' }],
      ]),
      '2026-03-14T03:10:00.000Z'
    );

    expect(result.match.status).toBe('in_progress');
    expect(result.match.home_score).toBe(31);
    expect(result.match.away_score).toBe(21);
    expect(result.match.home_score_breakdown).toBe('5.1');
    expect(result.match.away_score_breakdown).toBe('3.3');
    expect(result.match.current_quarter).toBe(2);
    expect(result.match.live_clock_text).toBe('2:48');
    expect(result.playerStats).toHaveLength(2);
    expect(result.playerStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player_id: 'ply_marcus_bontempelli',
          team: 'Western Bulldogs',
          goals: 2,
          kicks: 8,
          handballs: 3,
        }),
        expect.objectContaining({
          player_id: 'ply_finn_callaghan',
          team: 'GWS',
          goals: 1,
          kicks: 5,
          handballs: 4,
        }),
      ])
    );
  });

  it('parses completed ft_match_statistics pages into final player stats', () => {
    const result = parseFootywireMatchHtml(
      `
        <table border="0" cellspacing="0" cellpadding="0" width="530" id="matchscoretable">
          <tr><th class="leftbold">Team</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Score</th></tr>
          <tr><td class="leftbold"><a href="th-western-bulldogs">Western Bulldogs</a></td><td>5.1</td><td>10.4</td><td>17.8</td><td>21.8</td><td>134</td></tr>
          <tr><td class="leftbold"><a href="th-greater-western-sydney-giants">GWS GIANTS</a></td><td>1.2</td><td>4.3</td><td>6.7</td><td>8.5</td><td>53</td></tr>
        </table>
        <table>
          <tr>
            <td class="innertbtitle" align="left">&nbsp;&nbsp;<b><a name="t1"></a>Western Bulldogs Match Statistics (Sorted by Disposals)</b></td>
          </tr>
          <tr>
            <td>
              <table border="0" cellspacing="0" cellpadding="3" width="823">
                <tr>
                  <td width="230" class="lbnorm" height="28">Player</td><td width="40" class="bnorm">K</td><td width="40" class="bnorm">HB</td><td width="40" class="bnorm">D</td><td width="40" class="bnorm">M</td><td width="40" class="bnorm">G</td><td width="40" class="bnorm">B</td><td width="40" class="bnorm">T</td><td width="40" class="bnorm">HO</td><td width="40" class="bnorm">GA</td><td width="40" class="bnorm">I50</td><td width="40" class="bnorm">CL</td><td width="40" class="bnorm">CG</td><td width="40" class="bnorm">R50</td><td width="40" class="bnorm">FF</td><td width="40" class="bnorm">FA</td><td width="40" class="bnorm">AF</td><td width="40" class="bnorm">SC</td>
                </tr>
                <tr class="darkcolor">
                  <td align="left" height="18"><a href="pp-western-bulldogs--marcus-bontempelli" title="Marcus Bontempelli">Marcus Bontempelli</a></td><td class="statdata">21</td><td class="statdata">12</td><td class="statdata">33</td><td class="statdata">6</td><td class="statdata">3</td><td class="statdata">1</td><td class="statdata">6</td><td class="statdata">0</td><td class="statdata">1</td><td class="statdata">7</td><td class="statdata">9</td><td class="statdata">4</td><td class="statdata">1</td><td class="statdata">1</td><td class="statdata">0</td><td class="statdata">139</td><td class="statdata">154</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table>
          <tr>
            <td class="innertbtitle" align="left">&nbsp;&nbsp;<b><a name="t2"></a>GWS Match Statistics (Sorted by Disposals)</b></td>
          </tr>
          <tr>
            <td>
              <table border="0" cellspacing="0" cellpadding="3" width="823">
                <tr>
                  <td width="230" class="lbnorm" height="28">Player</td><td width="40" class="bnorm">K</td><td width="40" class="bnorm">HB</td><td width="40" class="bnorm">D</td><td width="40" class="bnorm">M</td><td width="40" class="bnorm">G</td><td width="40" class="bnorm">B</td><td width="40" class="bnorm">T</td><td width="40" class="bnorm">HO</td><td width="40" class="bnorm">GA</td><td width="40" class="bnorm">I50</td><td width="40" class="bnorm">CL</td><td width="40" class="bnorm">CG</td><td width="40" class="bnorm">R50</td><td width="40" class="bnorm">FF</td><td width="40" class="bnorm">FA</td><td width="40" class="bnorm">AF</td><td width="40" class="bnorm">SC</td>
                </tr>
                <tr class="darkcolor">
                  <td align="left" height="18"><a href="pp-greater-western-sydney-giants--finn-callaghan" title="Finn Callaghan">Finn Callaghan</a></td><td class="statdata">18</td><td class="statdata">12</td><td class="statdata">30</td><td class="statdata">3</td><td class="statdata">1</td><td class="statdata">1</td><td class="statdata">6</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">3</td><td class="statdata">5</td><td class="statdata">5</td><td class="statdata">0</td><td class="statdata">0</td><td class="statdata">1</td><td class="statdata">111</td><td class="statdata">136</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
      {
        season: 2026,
        roundNumber: 1,
        homeTeam: 'Western Bulldogs',
        awayTeam: 'GWS',
        dateText: 'Sat 14 Mar 1:15pm',
        venue: 'Marvel Stadium',
        footywireMid: '11412',
        resultText: '134-53',
        status: 'final',
      },
      new Map([
        ['marcus bontempelli|western bulldogs', { id: 'marcus_bontempelli', name: 'Marcus Bontempelli', team: 'Western Bulldogs', position: 'MID' }],
        ['finn callaghan|gws', { id: 'finn_callaghan', name: 'Finn Callaghan', team: 'GWS', position: 'MID' }],
      ]),
      '2026-03-14T05:30:00.000Z'
    );

    expect(result.match.status).toBe('final');
    expect(result.match.home_score).toBe(134);
    expect(result.match.away_score).toBe(53);
    expect(result.match.home_score_breakdown).toBe('21.8');
    expect(result.match.away_score_breakdown).toBe('8.5');
    expect(result.playerStats).toHaveLength(2);
    expect(result.playerStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player_id: 'ply_marcus_bontempelli',
          team: 'Western Bulldogs',
          goals: 3,
          kicks: 21,
          handballs: 12,
          inside_50s: 7,
          fantasy_points: 139,
        }),
        expect.objectContaining({
          player_id: 'ply_finn_callaghan',
          team: 'GWS',
          goals: 1,
          kicks: 18,
          handballs: 12,
          inside_50s: 3,
          fantasy_points: 111,
        }),
      ])
    );
  });
});
