import * as cheerio from 'cheerio';

import { normalizeTeamName } from '@/lib/teamLogos';

export type FootywireMatchStatus = 'scheduled' | 'in_progress' | 'final';

export type LiveScoreboardMatch = {
  season: number;
  roundNumber: number;
  homeTeam: string;
  awayTeam: string;
  footywireMid?: string;
  status: FootywireMatchStatus;
  /** Total scores from the live scoreboard card (when present). */
  homeScore?: number;
  awayScore?: number;
};

type LiveScoreboardParseResult = {
  liveMatches: LiveScoreboardMatch[];
  completedMatches: LiveScoreboardMatch[];
  scheduledMatches: LiveScoreboardMatch[];
};

function findDefaultSeasonAndRound($: cheerio.CheerioAPI): {
  season: number | null;
  roundNumber: number | null;
} {
  const headings = $('h2.livestats')
    .toArray()
    .map((element) => cleanText($(element).text()));

  for (const heading of headings) {
    const season = parseSeason(heading);
    const roundNumber = parseRoundNumber(heading);
    if (season !== null && roundNumber !== null) {
      return { season, roundNumber };
    }
  }

  return { season: null, roundNumber: null };
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLiveCardScore(value: string): number | undefined {
  const text = cleanText(value);
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRoundNumber(heading: string): number | null {
  if (/opening round/i.test(heading)) {
    return 0;
  }

  const match = heading.match(/\bRound\s+(\d+)\b/i);
  if (!match) return null;

  const roundNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(roundNumber) ? roundNumber : null;
}

function parseSeason(heading: string): number | null {
  const match = heading.match(/\b(20\d{2})\b/);
  if (!match) return null;

  const season = Number.parseInt(match[1], 10);
  return Number.isFinite(season) ? season : null;
}

function resolveTeamNameFromLink(href: string | undefined, fallbackText: string): string {
  if (href) {
    const slug = href
      .replace(/^.*th-/, '')
      .replace(/[?#].*$/, '')
      .replace(/-/g, ' ');
    const normalizedFromHref = normalizeTeamName(slug);
    if (normalizedFromHref) return normalizedFromHref;
  }

  return normalizeTeamName(fallbackText);
}

function parseScoreboardSectionStatus(heading: string): FootywireMatchStatus | null {
  if (/current match/i.test(heading)) return 'in_progress';
  if (/live now/i.test(heading)) return 'in_progress';
  if (/completed match/i.test(heading)) return 'final';
  if (/scheduled match/i.test(heading)) return 'scheduled';
  if (/upcoming match/i.test(heading)) return 'scheduled';
  return null;
}

function parseMatchCard(
  tableHtml: cheerio.Cheerio<any>,
  season: number,
  roundNumber: number,
  status: FootywireMatchStatus
): LiveScoreboardMatch | null {
  const rows = tableHtml.find('tr');
  if (rows.length < 2) return null;

  const homeLink = rows.eq(0).find('a').first();
  const awayLink = rows.eq(1).find('a').first();

  const homeTeam = resolveTeamNameFromLink(homeLink.attr('href'), cleanText(homeLink.text()));
  const awayTeam = resolveTeamNameFromLink(awayLink.attr('href'), cleanText(awayLink.text()));
  if (!homeTeam || !awayTeam) return null;

  const footywireMid = rows
    .find('a[href*="live_stats?mid="], a[href*="ft_match_statistics?mid="]')
    .first()
    .attr('href')
    ?.match(/\b(?:live_stats|ft_match_statistics)\?mid=(\d+)/)?.[1];

  const homeScoreCells = rows.eq(0).children('td');
  const awayScoreCells = rows.eq(1).children('td');
  const homeScore =
    homeScoreCells.length >= 2 ? parseLiveCardScore(homeScoreCells.last().text()) : undefined;
  const awayScore =
    awayScoreCells.length >= 2 ? parseLiveCardScore(awayScoreCells.last().text()) : undefined;

  return {
    season,
    roundNumber,
    homeTeam,
    awayTeam,
    footywireMid,
    status,
    ...(homeScore !== undefined ? { homeScore } : {}),
    ...(awayScore !== undefined ? { awayScore } : {}),
  };
}

export function determineFootywireFixtureStatus(options: {
  footywireMid?: string;
  resultText?: string;
  liveMatchMids?: ReadonlySet<string>;
}): FootywireMatchStatus {
  const resultText = cleanText(options.resultText ?? '');

  if (options.footywireMid && options.liveMatchMids?.has(options.footywireMid)) {
    return 'in_progress';
  }

  if (options.footywireMid && /^\d+\s*-\s*\d+$/.test(resultText)) {
    return 'final';
  }

  return 'scheduled';
}

export function parseLiveScoreboard(html: string): LiveScoreboardParseResult {
  const $ = cheerio.load(html);
  const fallback = findDefaultSeasonAndRound($);
  const result: LiveScoreboardParseResult = {
    liveMatches: [],
    completedMatches: [],
    scheduledMatches: [],
  };

  $('h2.livestats').each((_, headingElement) => {
    const heading = cleanText($(headingElement).text());
    const status = parseScoreboardSectionStatus(heading);
    const season = parseSeason(heading) ?? fallback.season;
    const roundNumber = parseRoundNumber(heading) ?? fallback.roundNumber;
    if (!status || season === null || roundNumber === null) return;

    const immediateSection = $(headingElement).next();
    const directSectionTables = immediateSection
      .filter('table.livestats')
      .add(immediateSection.find('table.livestats'));
    const nestedSectionTables = directSectionTables.filter(
      (_, tableElement) => $(tableElement).find('table.livestats').length === 0
    );
    const sectionTables =
      nestedSectionTables.length > 0 ? nestedSectionTables : directSectionTables;

    sectionTables.each((__, tableElement) => {
      const parsed = parseMatchCard($(tableElement), season, roundNumber, status);
      if (!parsed) return;

      if (status === 'in_progress') {
        result.liveMatches.push(parsed);
      } else if (status === 'final') {
        result.completedMatches.push(parsed);
      } else {
        result.scheduledMatches.push(parsed);
      }
    });
  });

  return result;
}
