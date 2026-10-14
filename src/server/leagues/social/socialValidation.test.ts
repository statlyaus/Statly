import { describe, expect, it } from 'vitest';

import { SOCIAL_REPLY_MAX_LENGTH, editReplySchema } from './socialValidation';

describe('social text validation', () => {
  it('trims padding before applying the length limit', () => {
    const body = `   ${'a'.repeat(SOCIAL_REPLY_MAX_LENGTH)}   `;

    const parsed = editReplySchema.safeParse({ body });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.body).toHaveLength(SOCIAL_REPLY_MAX_LENGTH);
    }
  });

  it('still rejects text that is too long once trimmed', () => {
    const parsed = editReplySchema.safeParse({ body: 'a'.repeat(SOCIAL_REPLY_MAX_LENGTH + 1) });

    expect(parsed.success).toBe(false);
  });

  it('rejects whitespace-only text', () => {
    expect(editReplySchema.safeParse({ body: '     ' }).success).toBe(false);
  });
});
