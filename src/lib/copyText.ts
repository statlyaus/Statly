/**
 * Copies text for the user. Tries the Clipboard API, which is missing outside secure contexts and
 * can be denied by permissions, then a hidden textarea with document.execCommand('copy') for older
 * browsers. Resolves false when neither worked, so the caller can show the text to copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: try the legacy path below.
  }
  return copyWithHiddenTextarea(text);
}

function copyWithHiddenTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}
