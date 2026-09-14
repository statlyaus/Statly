import { OFFICIAL_AFL_2010_SESSION_SOURCES } from './officialAflDraft2010SessionFacts';
import { OFFICIAL_AFL_2010_REPORT } from './officialAflDraft2010PdfFacts';
import { createHash } from 'node:crypto';
import type { AflTradeExternalPageCapture } from './externalDraftTradeIngestion';
import { GWS_MINI_GRANT_URL } from './officialAflIssuingAwardAdapter';
import { OFFICIAL_AFL_MINI_2011_SOURCES } from './officialAflMiniDraft2011SessionFacts';

async function readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('External source response body is absent.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('bounded source limit exceeded');
        throw new Error('External source response exceeds the configured byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export async function captureOfficialAflPage(input: {
  url: string;
  validators: { eTag: string | null; lastModified: string | null } | null;
  maximumBytes: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<AflTradeExternalPageCapture> {
  const url = new URL(input.url);
  const reviewedPdf = url.href === OFFICIAL_AFL_2010_REPORT.url;
  if (
    !reviewedPdf &&
    (url.protocol !== 'https:' ||
      (url.hostname !== 'www.afl.com.au' &&
        url.href !== GWS_MINI_GRANT_URL &&
        url.href !== OFFICIAL_AFL_2010_SESSION_SOURCES.collingwood.url &&
        !Object.values(OFFICIAL_AFL_MINI_2011_SOURCES).some((source) => source.url === url.href)) ||
      !/^\/news\/\d+\/[a-z0-9-]+(?:\/amp)?$/.test(url.pathname) ||
      url.search ||
      url.hash)
  ) {
    throw new TypeError('Official AFL capture URL is outside the approved article path.');
  }
  const headers = new Headers({
    Accept: reviewedPdf ? 'application/pdf' : 'text/html,application/xhtml+xml',
  });
  if (input.validators?.eTag) headers.set('If-None-Match', input.validators.eTag);
  if (input.validators?.lastModified)
    headers.set('If-Modified-Since', input.validators.lastModified);
  const response = await input.fetchImpl(url.href, {
    method: 'GET',
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const eTag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (response.status === 304)
    return { status: 'not_modified', sourceUrl: url.href, eTag, lastModified };
  if (response.status !== 200) throw new Error(`Official AFL capture returned ${response.status}.`);
  const mediaType = response.headers.get('content-type') ?? '';
  if (
    reviewedPdf
      ? mediaType.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf'
      : !/^text\/html\b/i.test(mediaType)
  )
    throw new Error('Official AFL capture returned unsupported content type.');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > input.maximumBytes)
    throw new Error('Official AFL response exceeds the configured byte limit.');
  const bytes = await readBounded(response, input.maximumBytes);
  return {
    status: 'captured',
    sourceUrl: url.href,
    bytes,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType,
    eTag,
    lastModified,
  };
}
