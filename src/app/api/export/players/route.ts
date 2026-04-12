import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = (() => {
    if (columns && columns.length) return columns;
    const colsSet: Set<string> = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r)) colsSet.add(k);
    }
    return Array.from(colsSet);
  })();
  const escape = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => escape(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const rows: Record<string, any>[] = Array.isArray(body?.rows) ? body.rows : [];
    const columns: string[] | undefined = Array.isArray(body?.columns) ? body.columns : undefined;
    const fileName =
      typeof body?.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'export.csv';

    const csv = toCsv(rows, columns);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to generate CSV', details: e?.message || String(e) },
      { status: 400 }
    );
  }
}
