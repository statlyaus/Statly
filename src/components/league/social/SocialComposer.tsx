'use client';

import { LoaderCircle, SendHorizontal } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

interface SocialComposerProps {
  label: string;
  placeholder: string;
  submitLabel: string;
  maxLength: number;
  onSubmit: (value: string) => Promise<void> | void;
  submitOnEnter?: boolean;
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  initialValue?: string;
  compact?: boolean;
  leadingAction?: ReactNode;
}

export default function SocialComposer({
  label,
  placeholder,
  submitLabel,
  maxLength,
  onSubmit,
  submitOnEnter = false,
  disabled = false,
  pending = false,
  error,
  initialValue = '',
  compact = false,
  leadingAction,
}: SocialComposerProps): React.JSX.Element {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialValue);
  const trimmedValue = value.trim();
  const canSubmit = !disabled && !pending && trimmedValue.length > 0 && value.length <= maxLength;
  const nearLimit = value.length >= maxLength * 0.8;

  useLayoutEffect(() => {
    if (!compact || !inputRef.current) return;
    const input = inputRef.current;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [compact, value]);

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    try {
      await onSubmit(trimmedValue);
      setValue('');
    } catch {
      // The owning controller exposes the actionable error beside the composer.
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      !submitOnEnter ||
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submit();
  }

  return (
    <form className={compact ? 'group space-y-1.5' : 'space-y-2'} onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div
        className={
          compact
            ? 'flex min-h-12 items-end gap-1 rounded-2xl border border-border bg-background p-1 shadow-sm transition focus-within:ring-2 focus-within:ring-ring'
            : undefined
        }
      >
        {compact && leadingAction ? (
          <div className="flex min-h-10 shrink-0 items-center">{leadingAction}</div>
        ) : null}
        <textarea
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={compact ? 1 : submitOnEnter ? 3 : 6}
          disabled={disabled || pending}
          aria-invalid={Boolean(error)}
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
          className={
            compact
              ? 'block min-h-10 max-h-32 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60'
              : 'block w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
          }
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={compact ? submitLabel : undefined}
          className={
            compact
              ? 'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40'
              : 'inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          {compact ? (
            pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-4" aria-hidden="true" />
            )
          ) : pending ? (
            'Sending…'
          ) : (
            submitLabel
          )}
        </button>
      </div>
      <p id={helpId} className={compact ? 'sr-only' : 'text-xs text-muted-foreground'}>
        {submitOnEnter ? 'Enter to send · Shift+Enter for a new line · ' : ''}
        {value.length.toLocaleString()} / {maxLength.toLocaleString()}
      </p>
      {compact ? (
        <div
          aria-hidden="true"
          className={`justify-end px-2 text-xs text-muted-foreground ${
            nearLimit ? 'flex' : 'hidden group-focus-within:flex'
          }`}
        >
          {submitOnEnter ? 'Enter to send · Shift+Enter for a new line · ' : ''}
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
