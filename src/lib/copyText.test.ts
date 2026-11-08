import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './copyText';

function setClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function setExecCommand(execCommand: unknown) {
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
});

describe('copyText', () => {
  it('uses the Clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn();
    setClipboard({ writeText });
    setExecCommand(execCommand);

    await expect(copyText('https://statly.test/x')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://statly.test/x');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a hidden textarea when the Clipboard API is denied', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    let copied = '';
    const execCommand = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    setExecCommand(execCommand);
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();

    await expect(copyText('https://statly.test/x')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe('https://statly.test/x');
    expect(document.querySelector('textarea')).toBeNull();
    expect(button).toHaveFocus();
    button.remove();
  });

  it('falls back when the Clipboard API is missing', async () => {
    setClipboard(undefined);
    setExecCommand(vi.fn(() => true));

    await expect(copyText('code')).resolves.toBe(true);
  });

  it('reports failure when both paths fail', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    setExecCommand(vi.fn(() => false));
    await expect(copyText('code')).resolves.toBe(false);

    setExecCommand(
      vi.fn(() => {
        throw new Error('unsupported');
      })
    );
    await expect(copyText('code')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
