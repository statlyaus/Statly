import { describe, expect, it } from 'vitest';

import {
  SOCIAL_REPLY_MAX_LENGTH,
  createMessageSchema,
  editMessageSchema,
  editReplySchema,
} from './socialValidation';

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

  it('rejects a message made only of invisible characters', () => {
    const blank = '\u200B\u2060\uFEFF \u0000';
    expect(editMessageSchema.safeParse({ content: blank }).success).toBe(false);
    expect(
      createMessageSchema.safeParse({ content: blank, idempotencyKey: 'message-key-1' }).success
    ).toBe(false);
  });

  it('removes bidirectional overrides and control characters but keeps line breaks and emoji joiners', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const parsed = editMessageSchema.parse({
      content: `safe\u202Etxt.exe\u202C\nline two\u0007 ${family}`,
    });
    expect(parsed.content).toBe(`safetxt.exe\nline two ${family}`);
  });
});
