'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';

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
}: SocialComposerProps): React.JSX.Element {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState(initialValue);
  const trimmedValue = value.trim();
  const canSubmit = !disabled && !pending && trimmedValue.length > 0 && value.length <= maxLength;

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
    <form className="space-y-2" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <textarea
        id={inputId}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={submitOnEnter ? 3 : 6}
        disabled={disabled || pending}
        aria-invalid={Boolean(error)}
        aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
        className="block w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={helpId} className="text-xs text-muted-foreground">
          {submitOnEnter ? 'Enter to send · Shift+Enter for a new line · ' : ''}
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Sending…' : submitLabel}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
