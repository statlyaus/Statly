import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft queue design architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/components/draft/DraftQueue.tsx'), 'utf8');

  it('uses compact token-based rail sections instead of legacy wide cards', () => {
    const queueSource = source();

    expect(queueSource).toContain('flex min-h-0 flex-1 flex-col gap-3');
    expect(queueSource).toContain('border border-border bg-background p-3');
    expect(queueSource).toContain('bg-card');
    expect(queueSource).toContain('text-muted-foreground');
    expect(queueSource).toContain('truncate');
    expect(queueSource).not.toContain('bg-white rounded-lg shadow-sm border border-gray-200 p-6');
    expect(queueSource).not.toContain('text-gray-900');
    expect(queueSource).not.toContain('bg-gray-50');
  });

  it('keeps narrow rail actions icon or short label based', () => {
    const queueSource = source();

    expect(queueSource).toContain("aria-label={isEditing ? 'Finish editing draft queue'");
    expect(queueSource).toContain('aria-label="Clear draft queue"');
    expect(queueSource).toMatch(/>\s*Add\s*<\/button>/);
    expect(queueSource).not.toContain('Add to Queue</button>');
    expect(queueSource).not.toContain(">{isEditing ? 'Done Editing' : 'Edit Queue'}");
  });
});
