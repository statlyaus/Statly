import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('global reduced-motion styles', () => {
  it('reduces animation, transitions, and smooth scrolling for the user preference', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const reducedMotionRule = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/);

    expect(reducedMotionRule).not.toBeNull();
    expect(reducedMotionRule?.[1]).toContain('scroll-behavior: auto !important');
    expect(reducedMotionRule?.[1]).toContain('animation-duration: 0.01ms !important');
    expect(reducedMotionRule?.[1]).toContain('animation-iteration-count: 1 !important');
    expect(reducedMotionRule?.[1]).toContain('transition-duration: 0.01ms !important');
    expect(reducedMotionRule?.[1]).toContain('transition-delay: 0ms !important');
  });
});
