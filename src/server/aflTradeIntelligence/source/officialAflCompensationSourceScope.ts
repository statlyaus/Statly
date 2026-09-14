/** Exact reviewed reference locations; inclusion grants no source rights or factual approval. */
const compensationReferences = [
  ['https://www.afl.com.au/news/537729/nab-afl-draft-order-locked-in', 'text/html'],
  ['https://www.lions.com.au/news/730793/descendent-from-the-merger', 'text/html'],
  [
    'https://www.afl.com.au/news/103376/statement-suns-giants-activate-compo-draft-picks',
    'text/html',
  ],
  [
    'https://resources.afl.com.au/afl/document/2019/12/05/961d597e-b5d8-42b6-9f66-f2518cdd279b/2013-AFL-Annual-Report-min.pdf',
    'application/pdf',
  ],
  [
    'https://resources.afl.com.au/afl/document/2019/12/05/59317d2f-a338-4833-a242-21f858d6fa81/AFL-Annual-Report-2012_web-min.pdf',
    'application/pdf',
  ],
  [
    'https://www.afl.com.au/news/93491/gold-coast-activate-compensation-pick-for-2015-draft',
    'text/html',
  ],
  ['https://www.afl.com.au/news/81535/gold-coast-draft-rules-explained', 'text/html'],
  ['https://www.melbournefc.com.au/news/774653/afl-compensation-explained', 'text/html'],
] as const;

export function reviewedOfficialAflCompensationSource(
  url: string
): { mediaType: 'text/html' | 'application/pdf' } | null {
  const reference = compensationReferences.find(([sourceUrl]) => sourceUrl === url);
  return reference ? { mediaType: reference[1] } : null;
}
