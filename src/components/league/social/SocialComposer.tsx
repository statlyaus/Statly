'use client';

import { LoaderCircle, RotateCcw, SendHorizontal, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  clearSocialComposerDraft,
  createSocialComposerAttemptKey,
  getSocialComposerDraftKey,
  readSocialComposerDraft,
  writeSocialComposerDraft,
  type SocialComposerDraftScope,
} from './socialComposerDraft';

interface SocialComposerProps {
  label: string;
  placeholder: string;
  submitLabel: string;
  maxLength: number;
  onSubmit: (value: string, idempotencyKey: string) => Promise<void> | void;
  onDismissError?: () => void;
  submitOnEnter?: boolean;
  disabled?: boolean;
  pending?: boolean;
  error?: string | null;
  initialValue?: string;
  compact?: boolean;
  leadingAction?: ReactNode;
  draftScope?: SocialComposerDraftScope;
}

type SubmissionState = 'idle' | 'submitting' | 'failed';

const COMPOSER_MAX_HEIGHT_PX = 96;

export default function SocialComposer({
  label,
  placeholder,
  submitLabel,
  maxLength,
  onSubmit,
  onDismissError,
  submitOnEnter = false,
  disabled = false,
  pending = false,
  error,
  initialValue = '',
  compact = false,
  leadingAction,
  draftScope,
}: SocialComposerProps): React.JSX.Element {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const [value, setValue] = useState(initialValue);
  const [attemptKey, setAttemptKey] = useState<string | undefined>();
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [externalErrorDismissed, setExternalErrorDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [finePointer, setFinePointer] = useState(true);
  const draftKey = draftScope ? getSocialComposerDraftKey(draftScope) : null;
  const trimmedValue = value.trim();
  const isSubmitting = submissionState === 'submitting' || pending;
  const visibleError = localError ?? (!externalErrorDismissed ? error : null);
  const hasFailure = submissionState === 'failed' || Boolean(visibleError);
  const canSubmit =
    !disabled && online && !isSubmitting && trimmedValue.length > 0 && value.length <= maxLength;
  const showCounter = value.length >= Math.min(800, maxLength);
  const counterTone =
    value.length >= maxLength
      ? 'font-semibold text-destructive'
      : value.length >= Math.min(950, maxLength)
        ? 'font-semibold text-warning'
        : 'text-muted-foreground';
  const sendLabel = isSubmitting
    ? 'Sending message'
    : hasFailure
      ? 'Retry sending message'
      : !online
        ? 'Sending unavailable while offline'
        : submitLabel;

  useEffect(() => {
    if (!draftKey || typeof window === 'undefined') return;
    const restored = readSocialComposerDraft(window.localStorage, draftKey);
    skipNextPersistRef.current = true;
    setValue(restored?.value ?? initialValue);
    setAttemptKey(restored?.attemptKey);
    setSubmissionState(restored?.attemptKey ? 'failed' : 'idle');
    setLocalError(
      restored?.attemptKey
        ? 'Message delivery was not confirmed. Retry to reconcile this message.'
        : null
    );
    setExternalErrorDismissed(false);
  }, [draftKey, initialValue]);

  useEffect(() => {
    if (!draftKey || typeof window === 'undefined') return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    writeSocialComposerDraft(window.localStorage, draftKey, { value, attemptKey });
  }, [attemptKey, draftKey, value]);

  useEffect(() => {
    const markOnline = () => {
      setOnline(true);
      setAnnouncement('Connection restored. Your draft is ready to send.');
    };
    const markOffline = () => {
      setOnline(false);
      setAnnouncement('You are offline. Your message draft has been preserved.');
    };
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const pointerQuery = window.matchMedia('(pointer: fine)');
    const updatePointer = () => setFinePointer(pointerQuery.matches);
    updatePointer();
    pointerQuery.addEventListener?.('change', updatePointer);
    return () => pointerQuery.removeEventListener?.('change', updatePointer);
  }, []);

  useEffect(() => {
    if (error) setExternalErrorDismissed(false);
  }, [error]);

  useLayoutEffect(() => {
    if (!compact || !inputRef.current) return;
    const input = inputRef.current;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [compact, value]);

  function persistAttempt(nextAttemptKey: string): void {
    if (!draftKey || typeof window === 'undefined') return;
    writeSocialComposerDraft(window.localStorage, draftKey, {
      value,
      attemptKey: nextAttemptKey,
    });
  }

  async function submit(): Promise<void> {
    if (!canSubmit || submittingRef.current) return;
    const nextAttemptKey = attemptKey ?? createSocialComposerAttemptKey('chat');
    submittingRef.current = true;
    setAttemptKey(nextAttemptKey);
    setSubmissionState('submitting');
    setLocalError(null);
    setExternalErrorDismissed(false);
    setAnnouncement('Sending message.');
    persistAttempt(nextAttemptKey);

    try {
      await onSubmit(trimmedValue, nextAttemptKey);
      setValue('');
      setAttemptKey(undefined);
      setSubmissionState('idle');
      setAnnouncement('Message sent.');
      if (draftKey && typeof window !== 'undefined') {
        clearSocialComposerDraft(window.localStorage, draftKey);
      }
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (submissionError) {
      const message =
        submissionError instanceof Error ? submissionError.message : 'Message could not be sent.';
      setSubmissionState('failed');
      setLocalError(message);
      setAnnouncement(`${message} Your message was preserved.`);
      persistAttempt(nextAttemptKey);
    } finally {
      submittingRef.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      !submitOnEnter ||
      !finePointer ||
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void submit();
  }

  function handleValueChange(nextValue: string): void {
    setValue(nextValue.slice(0, maxLength));
    if (attemptKey || hasFailure) {
      setAttemptKey(undefined);
      setSubmissionState('idle');
      setLocalError(null);
      setExternalErrorDismissed(false);
      onDismissError?.();
    }
  }

  function dismissError(): void {
    setLocalError(null);
    setExternalErrorDismissed(true);
    onDismissError?.();
    inputRef.current?.focus();
  }

  return (
    <form className="relative space-y-2" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div
        className={
          compact
            ? 'flex min-h-14 items-end gap-0.5 rounded-xl border border-border bg-background p-1.5 shadow-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30'
            : undefined
        }
      >
        {compact && leadingAction ? (
          <div className="flex min-h-11 shrink-0 items-center">{leadingAction}</div>
        ) : null}
        <textarea
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => handleValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={compact ? 1 : submitOnEnter ? 3 : 6}
          disabled={disabled}
          readOnly={isSubmitting}
          aria-invalid={Boolean(visibleError)}
          aria-describedby={`${helpId} ${statusId}${visibleError ? ` ${errorId}` : ''}`}
          className={
            compact
              ? 'block min-h-11 max-h-24 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-3 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60'
              : 'block w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
          }
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={compact ? sendLabel : undefined}
          className={
            compact
              ? 'inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40'
              : 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          {compact ? (
            isSubmitting ? (
              <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : hasFailure ? (
              <RotateCcw className="size-4" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-4" aria-hidden="true" />
            )
          ) : isSubmitting ? (
            'Sending…'
          ) : hasFailure ? (
            'Retry'
          ) : (
            submitLabel
          )}
        </button>
      </div>

      <p id={helpId} className="sr-only">
        {submitOnEnter && finePointer
          ? 'Enter to send. Shift plus Enter inserts a new line. '
          : 'Use the send button to submit. '}
        {value.length.toLocaleString()} of {maxLength.toLocaleString()} characters used.
      </p>
      <p id={statusId} aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {showCounter ? (
        <p
          aria-hidden="true"
          className={`pointer-events-none absolute -top-5 right-1 text-xs tabular-nums ${counterTone}`}
        >
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          {value.length >= maxLength ? ' · Limit reached' : ''}
        </p>
      ) : null}

      {!online ? (
        <p role="status" className="px-1 text-xs font-medium text-muted-foreground">
          You’re offline. Your draft is saved and sending is unavailable.
        </p>
      ) : null}

      {visibleError ? (
        <div
          id={errorId}
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
        >
          <p className="text-sm font-medium text-destructive">{visibleError}</p>
          <button
            type="button"
            onClick={dismissError}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Dismiss send error"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </form>
  );
}
