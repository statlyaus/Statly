'use client';

import { forwardRef, useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Form building blocks for the basketball pages: every field has a real label, its help and error
 * text linked with `aria-describedby`, and `aria-invalid` when the server rejected it.
 */

export function describedBy(id: string, help?: ReactNode, error?: string): string | undefined {
  return (
    [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined
  );
}

export function FieldHelp({ id, children }: { id: string; children?: ReactNode }) {
  return children ? (
    <p id={`${id}-help`} className="text-xs text-muted-foreground">
      {children}
    </p>
  ) : null;
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} className="text-sm font-medium text-destructive">
      {error}
    </p>
  ) : null;
}

/** A labelled control with help under the label and the error under the control. */
export function Field({
  id,
  label,
  help,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      <FieldHelp id={id}>{help}</FieldHelp>
      {children}
      <FieldError id={id} error={error} />
    </div>
  );
}

/** One titled block of a long form: title and summary on the left from md, fields on the right. */
export function FormSection({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-4 border-t border-border py-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
    >
      <div>
        <h2 id={`${id}-title`} className="font-display text-lg font-bold text-foreground">
          {title}
        </h2>
        {summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </section>
  );
}

export interface SummaryError {
  /** The id of the control to focus. */
  fieldId: string;
  message: string;
}

/**
 * The list of problems after a failed submit. The form moves focus here so keyboard and screen
 * reader users hear what went wrong; each entry links to its field.
 */
export const ErrorSummary = forwardRef<
  HTMLDivElement,
  { title: string; formErrors: string[]; errors: SummaryError[] }
>(function ErrorSummary({ title, formErrors, errors }, ref) {
  const titleId = useId();
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h2 id={titleId} className="text-sm font-bold text-foreground">
        {title}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
        {formErrors.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {errors.map((error) => (
          <li key={`${error.fieldId}:${error.message}`}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                const target = document.getElementById(error.fieldId);
                if (!target) return;
                event.preventDefault();
                target.focus();
                target.scrollIntoView({ block: 'center' });
              }}
              className="font-medium text-destructive underline underline-offset-2"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});
