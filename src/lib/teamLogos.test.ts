import { describe, expect, it } from 'vitest';

import teamLogosDefault, { getTeamAbbreviation, getTeamLogo, teamLogos } from './teamLogos';

const logoCases = [
  ['Adelaide Crows', '/logos/Adelaide.svg'],
  ['Crows', '/logos/Adelaide.svg'],
  ['ADEL', '/logos/Adelaide.svg'],
  ['ADL', '/logos/Adelaide.svg'],
  ['Brisbane Lions', '/logos/Brisbane.svg'],
  ['Lions', '/logos/Brisbane.svg'],
  ['BRI', '/logos/Brisbane.svg'],
  ['BL', '/logos/Brisbane.svg'],
  ['Carlton Blues', '/logos/Carlton.svg'],
  ['Blues', '/logos/Carlton.svg'],
  ['CAR', '/logos/Carlton.svg'],
  ['Collingwood Magpies', '/logos/Collingwood.svg'],
  ['Magpies', '/logos/Collingwood.svg'],
  ['COL', '/logos/Collingwood.svg'],
  ['Essendon Bombers', '/logos/Essendon.svg'],
  ['Bombers', '/logos/Essendon.svg'],
  ['ESS', '/logos/Essendon.svg'],
  ['Fremantle Dockers', '/logos/Fremantle.svg'],
  ['Dockers', '/logos/Fremantle.svg'],
  ['FRE', '/logos/Fremantle.svg'],
  ['Geelong Cats', '/logos/Geelong.svg'],
  ['Cats', '/logos/Geelong.svg'],
  ['GEE', '/logos/Geelong.svg'],
  ['GEEL', '/logos/Geelong.svg'],
  ['Gold Coast Suns', '/logos/Gold Coast.svg'],
  ['Suns', '/logos/Gold Coast.svg'],
  ['GC', '/logos/Gold Coast.svg'],
  ['GCS', '/logos/Gold Coast.svg'],
  ['GWS Giants', '/logos/GWS.svg'],
  ['Greater Western Sydney', '/logos/GWS.svg'],
  ['Giants', '/logos/GWS.svg'],
  ['GWS', '/logos/GWS.svg'],
  ['Hawthorn Hawks', '/logos/Hawthorn.svg'],
  ['Hawks', '/logos/Hawthorn.svg'],
  ['HAW', '/logos/Hawthorn.svg'],
  ['Melbourne Demons', '/logos/Melbourne.svg'],
  ['Demons', '/logos/Melbourne.svg'],
  ['MEL', '/logos/Melbourne.svg'],
  ['MELB', '/logos/Melbourne.svg'],
  ['North Melbourne Kangaroos', '/logos/North Melbourne.svg'],
  ['Kangaroos', '/logos/North Melbourne.svg'],
  ['NM', '/logos/North Melbourne.svg'],
  ['NTH', '/logos/North Melbourne.svg'],
  ['Port Adelaide Power', '/logos/Port Adelaide.svg'],
  ['Power', '/logos/Port Adelaide.svg'],
  ['PA', '/logos/Port Adelaide.svg'],
  ['PORT', '/logos/Port Adelaide.svg'],
  ['Richmond Tigers', '/logos/Richmond.svg'],
  ['Tigers', '/logos/Richmond.svg'],
  ['RIC', '/logos/Richmond.svg'],
  ['RICH', '/logos/Richmond.svg'],
  ['St Kilda Saints', '/logos/St Kilda.svg'],
  ['Saints', '/logos/St Kilda.svg'],
  ['STK', '/logos/St Kilda.svg'],
  ['Sydney Swans', '/logos/Sydney.svg'],
  ['Swans', '/logos/Sydney.svg'],
  ['SYD', '/logos/Sydney.svg'],
  ['West Coast Eagles', '/logos/West Coast.svg'],
  ['Eagles', '/logos/West Coast.svg'],
  ['WC', '/logos/West Coast.svg'],
  ['WCE', '/logos/West Coast.svg'],
  ['Western Bulldogs', '/logos/Western Bulldogs.svg'],
  ['Bulldogs', '/logos/Western Bulldogs.svg'],
  ['WB', '/logos/Western Bulldogs.svg'],
  ['WBD', '/logos/Western Bulldogs.svg'],
] as const;

const abbreviationCases = [
  ['ADEL', 'ADL'],
  ['Brisbane Lions', 'BRI'],
  ['BL', 'BRI'],
  ['CAR', 'CAR'],
  ['Magpies', 'COL'],
  ['GEEL', 'GEE'],
  ['GCS', 'GC'],
  ['Greater Western Sydney Giants', 'GWS'],
  ['MELB', 'MEL'],
  ['NTH', 'NM'],
  ['PORT', 'PA'],
  ['RICH', 'RIC'],
  ['Saints', 'STK'],
  ['WCE', 'WC'],
  ['WB', 'WBD'],
] as const;

describe('teamLogos', () => {
  it.each(logoCases)('normalizes %s to %s', (teamName, expectedLogo) => {
    expect(getTeamLogo(teamName)).toBe(expectedLogo);
  });

  it.each(abbreviationCases)('normalizes %s to %s', (teamName, expectedAbbreviation) => {
    expect(getTeamAbbreviation(teamName)).toBe(expectedAbbreviation);
  });

  it('falls back when no team alias matches', () => {
    expect(getTeamLogo('Tasmania Devils')).toBe('/logos/fallback.svg');
    expect(getTeamAbbreviation('Tasmania Devils')).toBe('TAS');
  });

  it('keeps the named and default logo exports backwards compatible', () => {
    expect(teamLogosDefault).toBe(teamLogos);
    expect(teamLogos.Adelaide).toBe('/logos/Adelaide.svg');
    expect(teamLogos['GWS Giants']).toBe('/logos/GWS.svg');
  });
});
