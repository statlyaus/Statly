import { createHash } from 'node:crypto';

export function buildDraftPartyId(rowOrder: number, clubSlug: string): string {
  return `${rowOrder}_${clubSlug}`;
}

export function buildDraftAssetBaseId(clubSlug: string, assetIndex: number): string {
  return `${clubSlug}_${assetIndex}`;
}

export function buildDraftAssetIdWithHash(
  clubSlug: string,
  assetIndex: number,
  assetText: string
): string {
  const base = buildDraftAssetBaseId(clubSlug, assetIndex);
  const suffix = createHash('sha1').update(assetText).digest('hex').slice(0, 8);
  return `${base}_${suffix}`;
}
