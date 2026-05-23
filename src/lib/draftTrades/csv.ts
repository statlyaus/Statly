export type CsvCellValue = string | number | boolean | null | undefined;

const spreadsheetFormulaPrefix = /^[=+\-@]/;

export function escapeCsvCell(value: CsvCellValue): string {
  if (value == null) return '';

  const raw = String(value);
  const safeValue =
    typeof value === 'string' && spreadsheetFormulaPrefix.test(raw.trimStart())
      ? `'${raw}`
      : raw;

  if (
    safeValue.includes(',') ||
    safeValue.includes('"') ||
    safeValue.includes('\n') ||
    safeValue.includes('\r')
  ) {
    return `"${safeValue.replaceAll('"', '""')}"`;
  }

  return safeValue;
}
