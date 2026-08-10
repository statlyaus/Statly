import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  parseAflTradeFitzRoyDecodedTable,
  type AflTradeFitzRoyDecodedTable,
} from './fitzRoyObservationContracts';
import {
  aflTradeFitzRoyCaptureReceiptSchema,
  type AflTradeFitzRoyCaptureReceipt,
} from './fitzRoyCaptureReceipt';

export const AFL_TRADE_FITZROY_DECODER_VERSION = 'afl-trade-fitzroy-rds-decoder/v1' as const;
const execFileAsync = promisify(execFile);

export interface AflTradeFitzRoyDecodeContext {
  captureReceiptSha256: string;
  capabilityId: string;
  fitzRoyVersion: '1.7.0';
  authorizationCompetition: 'AFLM' | 'AFLW';
  authorizationSeason: number;
  invocationSha256: string;
  invocationArgumentsSha256: string;
  diagnosticsSha256: string;
  sourceRdsSha256: string;
  sourceSchemaSha256: string;
  expectedRowCount: number;
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
  maximumRows: number;
  maximumFields: number;
  maximumCells: number;
  maximumCellBytes: number;
  maximumOutputBytes: number;
}

export interface AflTradeFitzRoyDecoderExecutor {
  readonly executionBoundary: 'fixture_process' | 'offline_container_no_network';
  decode(input: {
    sourceRdsBytes: Uint8Array;
    context: AflTradeFitzRoyDecodeContext;
    timeoutMs: number;
  }): Promise<Uint8Array>;
}

export class AflTradeFitzRoyDecodeError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'CUSTODY_MISMATCH'
      | 'DECODER_FAILED'
      | 'OUTPUT_TOO_LARGE'
      | 'OUTPUT_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFitzRoyDecodeError';
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Json(value: unknown): string {
  return sha256Bytes(new TextEncoder().encode(canonicalizeAflTradeJson(value)));
}

export function createAflTradeFitzRoyDecodeContext(input: {
  captureReceipt: AflTradeFitzRoyCaptureReceipt;
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
  maximumRows: number;
  maximumFields: number;
  maximumCells: number;
  maximumCellBytes: number;
  maximumOutputBytes: number;
}): AflTradeFitzRoyDecodeContext {
  const receipt = aflTradeFitzRoyCaptureReceiptSchema.parse(input.captureReceipt);
  const { content } = receipt;
  const authorizedCompetition = content.authorizationReceipt.content.request.competition;
  if (authorizedCompetition !== 'AFLM' && authorizedCompetition !== 'AFLW') {
    throw new AflTradeFitzRoyDecodeError(
      'INVALID_REQUEST',
      'Capture competition is outside the supported AFL intelligence boundary.'
    );
  }
  const fingerprint = content.schemaFingerprint.replace(/^sha256:/, '');
  for (const digest of [input.dependencyLockSha256, fingerprint]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new AflTradeFitzRoyDecodeError(
        'INVALID_REQUEST',
        'Decoder digest identity is invalid.'
      );
    }
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.imageDigest)) {
    throw new AflTradeFitzRoyDecodeError('INVALID_REQUEST', 'Decoder image identity is invalid.');
  }
  for (const bound of [
    input.maximumRows,
    input.maximumFields,
    input.maximumCells,
    input.maximumCellBytes,
    input.maximumOutputBytes,
  ]) {
    if (!Number.isSafeInteger(bound) || bound <= 0) {
      throw new AflTradeFitzRoyDecodeError(
        'INVALID_REQUEST',
        'Decoder bounds must be positive safe integers.'
      );
    }
  }
  return {
    captureReceiptSha256: sha256Json(receipt),
    capabilityId: content.invocation.capabilityId,
    fitzRoyVersion: content.invocation.fitzRoyVersion,
    authorizationCompetition: authorizedCompetition,
    authorizationSeason: content.authorizationReceipt.content.request.season,
    invocationSha256: content.invocationCustody.artifact.contentSha256,
    invocationArgumentsSha256: sha256Json(content.invocation.arguments),
    diagnosticsSha256: content.diagnosticsCustody.artifact.contentSha256,
    sourceRdsSha256: content.sourceCustody.artifact.contentSha256,
    sourceSchemaSha256: fingerprint,
    expectedRowCount: content.diagnostics.rowCount,
    dependencyLockSha256: input.dependencyLockSha256,
    imageDigest: input.imageDigest,
    maximumRows: input.maximumRows,
    maximumFields: input.maximumFields,
    maximumCells: input.maximumCells,
    maximumCellBytes: input.maximumCellBytes,
    maximumOutputBytes: input.maximumOutputBytes,
  };
}

export async function decodeAflTradeFitzRoyCapture(input: {
  captureReceipt: AflTradeFitzRoyCaptureReceipt;
  sourceRdsBytes: Uint8Array;
  executor: AflTradeFitzRoyDecoderExecutor;
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
  maximumRows: number;
  maximumFields: number;
  maximumCells: number;
  maximumCellBytes: number;
  maximumOutputBytes: number;
  timeoutMs: number;
}): Promise<{ table: AflTradeFitzRoyDecodedTable; decodedSha256: string }> {
  const fixtureDecode =
    input.captureReceipt.content.authorizationReceipt.content.request.environment ===
    'test_fixture';
  if (
    (fixtureDecode && input.executor.executionBoundary !== 'fixture_process') ||
    (!fixtureDecode && input.executor.executionBoundary !== 'offline_container_no_network')
  ) {
    throw new AflTradeFitzRoyDecodeError(
      'INVALID_REQUEST',
      fixtureDecode
        ? 'Fixture capture decoding requires the explicitly local fixture process.'
        : 'Non-fixture capture decoding requires the attested offline no-network container boundary.'
    );
  }
  const context = createAflTradeFitzRoyDecodeContext(input);
  if (sha256Bytes(input.sourceRdsBytes) !== context.sourceRdsSha256) {
    throw new AflTradeFitzRoyDecodeError(
      'CUSTODY_MISMATCH',
      'Decoder input bytes do not match the capture receipt RDS artifact.'
    );
  }
  const decodedBytes = await input.executor.decode({
    sourceRdsBytes: input.sourceRdsBytes,
    context,
    timeoutMs: input.timeoutMs,
  });
  if (decodedBytes.byteLength === 0 || decodedBytes.byteLength > input.maximumOutputBytes) {
    throw new AflTradeFitzRoyDecodeError(
      'OUTPUT_TOO_LARGE',
      'Decoded output is empty or exceeds its approved byte bound.'
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodedBytes));
  } catch {
    throw new AflTradeFitzRoyDecodeError(
      'OUTPUT_INVALID',
      'Decoder output is not valid UTF-8 JSON.'
    );
  }
  let table: AflTradeFitzRoyDecodedTable;
  try {
    table = parseAflTradeFitzRoyDecodedTable(parsedJson);
  } catch (error) {
    throw new AflTradeFitzRoyDecodeError(
      'OUTPUT_INVALID',
      error instanceof Error ? error.message : 'Decoded table contract is invalid.'
    );
  }
  if (
    table.captureReceiptSha256 !== context.captureReceiptSha256 ||
    table.capabilityId !== context.capabilityId ||
    table.authorizationCompetition !== context.authorizationCompetition ||
    table.authorizationSeason !== context.authorizationSeason ||
    table.invocationSha256 !== context.invocationSha256 ||
    table.invocationArgumentsSha256 !== context.invocationArgumentsSha256 ||
    table.diagnosticsSha256 !== context.diagnosticsSha256 ||
    table.sourceRdsSha256 !== context.sourceRdsSha256 ||
    table.sourceSchemaSha256 !== context.sourceSchemaSha256 ||
    table.rows.length !== context.expectedRowCount ||
    table.decoderRuntime.decoderVersion !== AFL_TRADE_FITZROY_DECODER_VERSION ||
    table.decoderRuntime.dependencyLockSha256 !== context.dependencyLockSha256 ||
    table.decoderRuntime.imageDigest !== context.imageDigest ||
    table.rows.length > context.maximumRows ||
    table.fields.length > context.maximumFields ||
    table.rows.length * table.fields.length > context.maximumCells
  ) {
    throw new AflTradeFitzRoyDecodeError(
      'CUSTODY_MISMATCH',
      'Decoded table does not bind the exact capture, runtime, schema, or approved bounds.'
    );
  }
  return { table, decodedSha256: sha256Bytes(decodedBytes) };
}

export class AflTradeLocalRscriptDecodeExecutor implements AflTradeFitzRoyDecoderExecutor {
  readonly executionBoundary = 'fixture_process' as const;

  constructor(
    private readonly options: {
      rscriptPath?: string;
      scriptPath?: string;
    } = {}
  ) {}

  async decode(input: {
    sourceRdsBytes: Uint8Array;
    context: AflTradeFitzRoyDecodeContext;
    timeoutMs: number;
  }): Promise<Uint8Array> {
    const directory = await mkdtemp(resolve(tmpdir(), 'statly-afl-trade-decode-'));
    const sourcePath = resolve(directory, 'source.rds');
    const contextPath = resolve(directory, 'context.json');
    const outputPath = resolve(directory, 'decoded.json');
    try {
      await writeFile(sourcePath, input.sourceRdsBytes, { flag: 'wx', mode: 0o600 });
      await writeFile(contextPath, canonicalizeAflTradeJson(input.context), {
        flag: 'wx',
        mode: 0o600,
      });
      const { stdout, stderr } = await execFileAsync(
        this.options.rscriptPath ?? 'Rscript',
        [
          '--vanilla',
          this.options.scriptPath ??
            resolve(process.cwd(), 'etl/afl-trade-intelligence/decode_fitzroy_capture.R'),
          sourcePath,
          contextPath,
          outputPath,
        ],
        {
          timeout: input.timeoutMs,
          maxBuffer: 8_192,
          windowsHide: true,
          env: {
            STATLY_R_LOCK_SHA256: input.context.dependencyLockSha256,
            STATLY_CAPTURE_IMAGE_DIGEST: input.context.imageDigest,
            NODE_ENV: 'production',
            PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
            HOME: directory,
            TMPDIR: directory,
            LANG: 'C.UTF-8',
            TZ: 'UTC',
          },
        }
      );
      if (stdout !== '' || stderr !== '') {
        throw new Error('R decoder emitted output outside its decoded artifact.');
      }
      const outputStat = await stat(outputPath);
      if (outputStat.size <= 0 || outputStat.size > input.context.maximumOutputBytes) {
        throw new Error('R decoder output exceeded its approved byte bound.');
      }
      return new Uint8Array(await readFile(outputPath));
    } catch (error) {
      throw new AflTradeFitzRoyDecodeError(
        'DECODER_FAILED',
        error instanceof Error ? error.message : 'R decoder failed.'
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
