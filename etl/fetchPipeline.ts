import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as path from 'path';
import { pipeline } from 'stream/promises';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

type FetchPipelineOptions = {
  season: number | string;
  round?: number | string;
  backfillMode?: boolean;
  timeoutMs?: number | null;
};

type EtlRuntimePaths = {
  etlRoot: string;
  fetcher: string;
  processor: string;
};

function resolveEtlRuntimePaths(runtimeDirectory: string = __dirname): EtlRuntimePaths {
  const etlRoot =
    path.basename(runtimeDirectory) === 'dist' ? path.dirname(runtimeDirectory) : runtimeDirectory;

  return {
    etlRoot,
    fetcher: path.join(etlRoot, 'fetch_fw_round.R'),
    processor: path.join(etlRoot, 'dist', 'processFootywireData.js'),
  };
}

function waitForSuccessfulExit(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      reject(new Error(`Failed to start ${label}: ${error.message}`));
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      reject(new Error(`${label} failed with ${reason}`));
    });
  });
}

function ensureRscriptAvailable(): void {
  const result = spawnSync('Rscript', ['--version'], { stdio: 'ignore' });

  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error(
      'Rscript is not installed or is not available on PATH. Install R and ensure Rscript is available.'
    );
  }

  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to run Rscript: ${result.error?.message ?? `exit code ${result.status ?? 'unknown'}`}`
    );
  }
}

function resolveFetchPipelineTimeout(options: FetchPipelineOptions): number | null {
  const configuredTimeout =
    options.timeoutMs !== undefined
      ? options.timeoutMs
      : options.backfillMode
        ? null
        : DEFAULT_TIMEOUT_MS;

  if (configuredTimeout === null || configuredTimeout === 0) return null;
  if (!Number.isFinite(configuredTimeout) || configuredTimeout < 0) {
    throw new Error('ETL fetch pipeline timeout must be a non-negative finite number or null');
  }
  return configuredTimeout;
}

async function runFetchPipeline(options: FetchPipelineOptions): Promise<void> {
  const { etlRoot, fetcher, processor } = resolveEtlRuntimePaths();
  const round = options.round === undefined ? '' : String(options.round);
  const timeoutMs = resolveFetchPipelineTimeout(options);

  ensureRscriptAvailable();

  const fetchProcess = spawn('Rscript', [fetcher, String(options.season), round], {
    cwd: etlRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processorProcess = spawn(process.execPath, [processor], {
    cwd: etlRoot,
    env: {
      ...process.env,
      BACKFILL_MODE: options.backfillMode ? 'true' : 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const processorInput = pipeline(fetchProcess.stdout!, processorProcess.stdin!).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
      return;
    }

    throw new Error(
      `Footywire fetcher output pipe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  fetchProcess.stderr?.pipe(process.stderr);
  processorProcess.stdout?.pipe(process.stdout);
  processorProcess.stderr?.pipe(process.stderr);

  fetchProcess.stdout?.on('error', (error) => {
    console.error('Footywire fetcher output failed:', error);
  });
  processorProcess.stdout?.on('error', (error) => {
    console.error('Footywire processor output failed:', error);
  });

  let timeout: NodeJS.Timeout | undefined;
  const pipelineCompletion = Promise.all([
    waitForSuccessfulExit(fetchProcess, 'Footywire R fetcher'),
    waitForSuccessfulExit(processorProcess, 'Footywire Node processor'),
    processorInput,
  ]);

  try {
    if (timeoutMs === null) {
      await pipelineCompletion;
    } else {
      await Promise.race([
        pipelineCompletion,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`ETL fetch pipeline timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (fetchProcess.exitCode === null) {
      fetchProcess.kill();
    }
    if (processorProcess.exitCode === null) {
      processorProcess.kill();
    }
  }
}

export { resolveEtlRuntimePaths, resolveFetchPipelineTimeout, runFetchPipeline };
export type { EtlRuntimePaths, FetchPipelineOptions };
