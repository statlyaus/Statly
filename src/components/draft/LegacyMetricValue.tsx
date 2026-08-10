export function LegacyMetricValue({
  value,
  missingLabel = 'Not recorded',
}: {
  value: number | null;
  missingLabel?: string;
}) {
  if (value !== null) return value;

  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{missingLabel}</span>
    </>
  );
}
