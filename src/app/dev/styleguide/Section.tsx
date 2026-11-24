import type { ReactNode } from 'react';

/** One part of the style guide page: a heading, one line on what it shows, then the specimens. */
export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}
