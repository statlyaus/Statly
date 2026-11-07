/**
 * Stat-line arithmetic shared by the basketball engine. Pure and isomorphic.
 */

import {
  NBA_STAT_KEYS,
  type BasketballCategoryDefinition,
  type NbaStatLine,
} from '@/types/basketball';

export function emptyStatLine(): NbaStatLine {
  return Object.fromEntries(NBA_STAT_KEYS.map((key) => [key, 0])) as NbaStatLine;
}

export function addStatLines(a: NbaStatLine, b: NbaStatLine): NbaStatLine {
  return Object.fromEntries(NBA_STAT_KEYS.map((key) => [key, a[key] + b[key]])) as NbaStatLine;
}

export function scaleStatLine(line: NbaStatLine, factor: number): NbaStatLine {
  return Object.fromEntries(NBA_STAT_KEYS.map((key) => [key, line[key] * factor])) as NbaStatLine;
}

/**
 * A team or player's value in one category: the count, or total makes over total attempts
 * (0 with no attempts). Direction is not applied here.
 */
export function categoryValue(line: NbaStatLine, category: BasketballCategoryDefinition): number {
  if (category.kind === 'COUNT') return line[category.stat];
  const attempted = line[category.attempted];
  return attempted > 0 ? line[category.made] / attempted : 0;
}
