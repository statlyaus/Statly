'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';

import { useEscapeKey, useFocusTrap } from '@/hooks/useAccessibility';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for actions that remove or discard something. */
  tone?: 'default' | 'danger';
}

export interface TextRequestOptions extends ConfirmOptions {
  inputLabel: string;
  required?: boolean;
}

type PendingRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (confirmed: boolean) => void }
  | { kind: 'text'; options: TextRequestOptions; resolve: (value: string | null) => void };

/**
 * In-page replacements for window.confirm and window.prompt. Render `dialog` once in the
 * component, then `await confirm({...})` (true when confirmed) or `await requestText({...})`
 * (the text, or null when cancelled).
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  requestText: (options: TextRequestOptions) => Promise<string | null>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = useState<PendingRequest | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: 'confirm', options, resolve })),
    []
  );
  const requestText = useCallback(
    (options: TextRequestOptions) =>
      new Promise<string | null>((resolve) => setPending({ kind: 'text', options, resolve })),
    []
  );

  const dialog = pending ? (
    <ConfirmDialogView
      key={pending.options.title}
      options={pending.options}
      input={pending.kind === 'text' ? pending.options : null}
      onCancel={() => {
        if (pending.kind === 'confirm') pending.resolve(false);
        else pending.resolve(null);
        setPending(null);
      }}
      onConfirm={(value) => {
        if (pending.kind === 'confirm') pending.resolve(true);
        else pending.resolve(value);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, requestText, dialog };
}

/**
 * The dialog itself, for callers that manage their own open state (such as the older
 * `useConfirmation` in `Modal.tsx`). `busy` disables it while the confirmed action runs.
 */
export function ConfirmDialogView({
  options,
  input = null,
  busy = false,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  input?: TextRequestOptions | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}): React.ReactPortal | null {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [showError, setShowError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useFocusTrap<HTMLDivElement>(mounted);
  useEscapeKey(onCancel, mounted && !busy);

  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  const danger = options.tone === 'danger';
  const invalid = Boolean(input?.required) && value.trim() === '';

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    if (invalid) {
      setShowError(true);
      return;
    }
    onConfirm(value.trim());
  }

  return createPortal(
    // Clicking the backdrop is a pointer shortcut; Escape and Cancel cover the keyboard.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl"
      >
        <form onSubmit={submit} noValidate>
          <h2 id={titleId} className="text-lg font-semibold leading-tight text-foreground">
            {options.title}
          </h2>
          {options.description ? (
            <div id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
              {options.description}
            </div>
          ) : null}

          {input ? (
            <div className="mt-4">
              <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
                {input.inputLabel}
              </label>
              <textarea
                id={inputId}
                rows={3}
                value={value}
                required={input.required}
                aria-invalid={showError && invalid ? true : undefined}
                aria-describedby={showError && invalid ? errorId : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setShowError(false);
                }}
                className="mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
              />
              {showError && invalid ? (
                <p id={errorId} className="mt-1 text-sm font-medium text-destructive">
                  Add a {input.inputLabel.toLowerCase()}.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 sm:h-10"
            >
              {options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70 sm:h-10 ${
                danger
                  ? 'bg-destructive text-white hover:bg-destructive/90'
                  : 'bg-brand-bar text-brand-bar-foreground hover:bg-brand-bar/90'
              }`}
            >
              {busy ? 'Working…' : options.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
