/**
 * Identifiers shared by the injury list writer and readers. Kept apart from the parser and the
 * ingestion module so readers (the lineup routes) do not pull cheerio into their bundle.
 */

export const FOOTYWIRE_INJURY_SOURCE = 'footywire';

export const FOOTYWIRE_INJURY_LIST_URL = 'https://www.footywire.com/afl/footy/injury_list';
