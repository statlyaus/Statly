'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';

import { buttonStyles, fieldStyles, floatingStyles } from '@/components/ui/controlStyles';
import { useEscapeKey, useFocusTrap } from '@/hooks/useAccessibility';
import { cn } from '@/lib/utils';

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
      className="fixed inset-0 z-[70] flex items-end justify-center bg-overlay p-4 sm:items-center"
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
        className={cn(floatingStyles(), 'w-full max-w-md p-6')}
      >
        <form onSubmit={submit} noValidate>
          <h2
            id={titleId}
            className="font-display text-xl font-black leading-tight text-foreground"
          >
            {options.title}
          </h2>
          {options.description ? (
            <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">
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
                // A text request opens on its field; a plain confirm opens on Cancel.
                data-autofocus
                aria-invalid={showError && invalid ? true : undefined}
                aria-describedby={showError && invalid ? errorId : undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setShowError(false);
                }}
                className={cn(
                  fieldStyles({ size: 'area' }),
                  'mt-1.5 resize-y aria-[invalid=true]:border-destructive'
                )}
              />
              {showError && invalid ? (
                <p id={errorId} className="mt-1 text-sm font-medium text-destructive">
                  Add a {input.inputLabel.toLowerCase()}.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Primary first and left-aligned (style guide, "Buttons"). */}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className={buttonStyles({ variant: danger ? 'danger' : 'primary' })}
            >
              {busy ? 'Working…' : options.confirmLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              data-autofocus={input ? undefined : true}
              className={buttonStyles({ variant: 'outline' })}
            >
              {options.cancelLabel ?? 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
