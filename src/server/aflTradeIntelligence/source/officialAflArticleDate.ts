/**
 * The afl.com.au article date element. The site renamed the non-AMP wrapper from `article__date` to
 * `article__byline-date` (seen 2026-10-08; the `datetime` values are unchanged). Completed-session
 * parser v19 accepts either wrapper; each parser still requires exactly one date element, so a page
 * with both or neither is refused.
 */
export const OFFICIAL_AFL_ARTICLE_DATE = '.article__date > time, .article__byline-date > time';
