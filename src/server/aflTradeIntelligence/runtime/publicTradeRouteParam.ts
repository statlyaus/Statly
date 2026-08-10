import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence';

export function parseAflTradePublicRouteParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const parsed = aflTradePublicIdSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
