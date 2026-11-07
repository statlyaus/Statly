// Shown when the separately published trade valuations could not be read. The factual record on
// the same page comes from its own reviewed release and is unaffected.
export function DraftValuationUnavailableNotice() {
  return (
    <section
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-card-foreground shadow-sm"
    >
      <p className="font-semibold">Statly trade values are temporarily unavailable</p>
      <p className="text-muted-foreground">
        The reviewed trade records below are unaffected. Grades and values will show again once the
        published valuation can be read.
      </p>
    </section>
  );
}
