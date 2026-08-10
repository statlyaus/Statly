import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative } from 'node:path';

import readExcelFile from 'read-excel-file/node';

import { createAflTradeByteArtifactRef } from '../artifacts/artifactReference';
import {
  AflOutcomesDevelopmentWorkbookError,
  normalizeAflOutcomesDevelopmentWorkbook,
  type AflOutcomesDevelopmentWorkbook,
} from './developmentWorkbookStructure';

export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MAX_BYTES = 128 * 1024 * 1024;

export interface LoadAflOutcomesDevelopmentWorkbookInput {
  workbookPath: string;
  expectedSha256: string;
  observedAt?: string;
  runtimeEnvironment?: string;
}

export interface AflOutcomesDevelopmentWorkbookFingerprint {
  originalFilename: string;
  byteLength: number;
  sha256: string;
  observedAt: string;
}

export function assertAflOutcomesDevelopmentWorkbookRuntime(runtimeEnvironment?: string) {
  if (runtimeEnvironment === 'production') {
    throw new AflOutcomesDevelopmentWorkbookError(
      'PRODUCTION_DISABLED',
      'Development workbook loading is disabled in production.'
    );
  }
}

function validateExpectedDigest(expectedSha256: string): string {
  const normalized = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_DIGEST',
      'AFL_OUTCOMES_DEV_WORKBOOK_SHA256 must be a lowercase or uppercase SHA-256 hex digest.'
    );
  }
  return normalized;
}

function digestsMatch(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

async function readDevelopmentWorkbookFile(workbookPath: string) {
  if (!workbookPath.trim()) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'MISSING_PATH',
      'AFL_OUTCOMES_DEV_WORKBOOK_PATH is required.'
    );
  }
  if (!isAbsolute(workbookPath)) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'PATH_NOT_ABSOLUTE',
      'The development workbook path must be absolute.'
    );
  }
  if (extname(workbookPath).toLowerCase() !== '.xlsx') {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_EXTENSION',
      'The development workbook must use the .xlsx format.'
    );
  }

  const resolvedPath = await realpath(workbookPath);
  const workspaceRelativePath = relative(process.cwd(), resolvedPath);
  if (
    workspaceRelativePath === '' ||
    (!workspaceRelativePath.startsWith('..') && !isAbsolute(workspaceRelativePath))
  ) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'WORKSPACE_PATH_FORBIDDEN',
      'The development workbook must remain outside the repository workspace.'
    );
  }
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'NOT_A_FILE',
      'The development workbook path must identify a regular file.'
    );
  }
  if (fileStat.size === 0) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'EMPTY_FILE',
      'The development workbook file is empty.'
    );
  }
  if (fileStat.size > AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MAX_BYTES) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'SIZE_LIMIT_EXCEEDED',
      'The development workbook exceeds the 128 MiB pre-read limit.'
    );
  }

  const bytes = await readFile(resolvedPath);
  if (bytes.byteLength !== fileStat.size) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_WORKBOOK',
      'The development workbook changed while it was being read.'
    );
  }
  return { bytes, fileStat, resolvedPath };
}

export async function fingerprintAflOutcomesDevelopmentWorkbook(input: {
  workbookPath: string;
  runtimeEnvironment?: string;
}): Promise<AflOutcomesDevelopmentWorkbookFingerprint> {
  assertAflOutcomesDevelopmentWorkbookRuntime(
    input.runtimeEnvironment ?? process.env.NODE_ENV
  );
  const { bytes, fileStat, resolvedPath } = await readDevelopmentWorkbookFile(input.workbookPath);
  return {
    originalFilename: basename(resolvedPath),
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    observedAt: fileStat.mtime.toISOString(),
  };
}

export async function loadAflOutcomesDevelopmentWorkbook(
  input: LoadAflOutcomesDevelopmentWorkbookInput
): Promise<AflOutcomesDevelopmentWorkbook> {
  assertAflOutcomesDevelopmentWorkbookRuntime(
    input.runtimeEnvironment ?? process.env.NODE_ENV
  );
  const expectedSha256 = validateExpectedDigest(input.expectedSha256);
  const { bytes, fileStat, resolvedPath } = await readDevelopmentWorkbookFile(input.workbookPath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!digestsMatch(actualSha256, expectedSha256)) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'DIGEST_MISMATCH',
      'The development workbook does not match AFL_OUTCOMES_DEV_WORKBOOK_SHA256.'
    );
  }

  const observedAt = input.observedAt ?? fileStat.mtime.toISOString();
  const sourceArtifact = createAflTradeByteArtifactRef(
    bytes,
    AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE,
    observedAt
  );

  try {
    const sheets = await readExcelFile<string>(bytes, {
      // Preserve the workbook's decimal representation. Converting through a
      // JavaScript number first could round identifiers or large statistics.
      parseNumber: (value) => value,
    });
    return normalizeAflOutcomesDevelopmentWorkbook({
      sheets,
      sourceArtifact,
      originalFilename: basename(resolvedPath),
    });
  } catch (error) {
    if (error instanceof AflOutcomesDevelopmentWorkbookError) throw error;
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_WORKBOOK',
      'The development workbook could not be parsed as a valid XLSX file.'
    );
  }
}
