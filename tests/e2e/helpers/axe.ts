import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.2 AA checks with axe (style guide, "Freeze drift", phase 3's last ticket). Returns one line
 * per violation and node, so a failure names the rule and the element. The story collage
 * (`[data-collage]`) is skipped for the same reason `brandAudit.ts` skips it: it is the trade page
 * head the owner is redesigning (ticket 06h).
 */
export async function axeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('[data-collage]')
    .analyze();
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`)
  );
}
