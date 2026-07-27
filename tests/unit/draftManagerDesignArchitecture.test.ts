import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft manager design architecture', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/components/league/DraftManager.tsx'), 'utf8');

  it('uses semantic theme tokens for commissioner draft management styling', () => {
    const draftManagerSource = source();

    expect(draftManagerSource).toContain('border border-border bg-card');
    expect(draftManagerSource).toContain('text-muted-foreground');
    expect(draftManagerSource).toContain('bg-primary px-4 py-3 text-primary-foreground');
    expect(draftManagerSource).toContain('bg-destructive/10');
    expect(draftManagerSource).toContain('focus-visible:ring-ring');
    expect(draftManagerSource).toContain('border border-input bg-background');
  });

  it('does not reintroduce legacy hard-coded draft manager colors', () => {
    const draftManagerSource = source();

    expect(draftManagerSource).not.toMatch(
      /\bbg-(gray|blue|green|yellow|orange|purple|red|white|black)-/
    );
    expect(draftManagerSource).not.toMatch(
      /\btext-(gray|blue|green|yellow|orange|purple|red|white)-/
    );
    expect(draftManagerSource).not.toMatch(
      /\bborder-(gray|blue|green|yellow|orange|purple|red|white)-/
    );
    expect(draftManagerSource).not.toContain('focus:border-transparent');
    expect(draftManagerSource).not.toContain('bg-opacity-50');
    expect(draftManagerSource).not.toContain('bg-gradient');
  });

  it('keeps the create-draft controls and behavior hooks intact', () => {
    const draftManagerSource = source();

    expect(draftManagerSource).toContain('Prepare the league draft room');
    expect(draftManagerSource).toContain('Prepare draft settings');
    expect(draftManagerSource).toContain('Join Draft Room');
    expect(draftManagerSource).toContain('View Draft Summary');
    expect(draftManagerSource).toContain("existingDraft?.status === 'COMPLETED'");
    expect(draftManagerSource).toContain('Draft Start Time');
    expect(draftManagerSource).toContain('Format and Clock');
    expect(draftManagerSource).toContain('Draft Order');
    expect(draftManagerSource).toContain('Position Limits');
    expect(draftManagerSource).toContain('Auto-pick when clock expires');
    expect(draftManagerSource).toContain('Send draft reminders to league members');
    expect(draftManagerSource).toContain('onClick={createDraft}');
    expect(draftManagerSource).toContain('onClick={joinDraftRoom}');
  });
});
