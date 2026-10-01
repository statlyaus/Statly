import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// DaisyUI is not registered as a Tailwind plugin, so its component classes produce no CSS and
// controls built from them render unstyled. Live surfaces use src/components/ui/controlStyles.
const migratedFiles = [
  'src/components/draft/DraftTradesExplorer.tsx',
  'src/components/draft/DraftTradeDetail.tsx',
  'src/components/draft/DraftClubTradeHistory.tsx',
  'src/components/draft/DraftClubsDirectory.tsx',
  'src/components/draft/AflTradeValueSummaryCard.tsx',
  'src/components/draft/AflTradeValueDetailPanel.tsx',
  'src/components/MatchLogTable.tsx',
  'src/hooks/useNotification.tsx',
  'src/app/(public)/terms/page.tsx',
  'src/app/(public)/privacy/page.tsx',
  'src/app/(public)/data-deletion/page.tsx',
];

const daisyClass =
  /(?<![\w-])(btn(-(primary|outline|ghost|sm|xs|lg|circle))?|badge(-(primary|outline|ghost|success|error|warning|info|accent|neutral|xs|sm|md))?|form-control|label-text|input-bordered|select-bordered|kbd-xs|link-hover|join-item|alert-(success|error|info)|modal(-(open|box|action))?|stat-(title|value)|(text|bg|border)-base-(content|100|200|300)|(text|bg|border)-(error|info|success)(\/\d+)?)(?![\w-])/;

function classStrings(source: string): string[] {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})|'([^'\n]*)'/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? ''
  );
}

describe('DaisyUI retirement', () => {
  it.each(migratedFiles)('%s uses Statly control styles instead of DaisyUI classes', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    const offenders = classStrings(source).filter((value) => daisyClass.test(value));

    expect(offenders).toEqual([]);
  });
});
