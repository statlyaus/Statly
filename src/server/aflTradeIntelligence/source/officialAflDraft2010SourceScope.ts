import { OFFICIAL_AFL_2010_SESSION_SOURCES } from './officialAflDraft2010SessionFacts';
import { OFFICIAL_AFL_2010_REPORT } from './officialAflDraft2010PdfFacts';
export const OFFICIAL_AFL_2010_ADDITIONS_URL =
  'https://www.afl.com.au/news/114795/countdown-to-d-day';
export function reviewedOfficialAflDraft2010Source(
  url: string
): { mediaType: 'text/html' | 'application/pdf'; effectiveAt: string | null } | null {
  if (url === OFFICIAL_AFL_2010_REPORT.url)
    return { mediaType: 'application/pdf', effectiveAt: null };
  if (url === OFFICIAL_AFL_2010_ADDITIONS_URL)
    return { mediaType: 'text/html', effectiveAt: '2010-11-13T05:41:00Z' };
  const source = Object.values(OFFICIAL_AFL_2010_SESSION_SOURCES).find((s) => s.url === url);
  return source ? { mediaType: 'text/html', effectiveAt: source.time } : null;
}
