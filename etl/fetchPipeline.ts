import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

type FetchPipelineOptions = {
  season: number | string;
  round?: number | string;
  backfillMode?: boolean;
  timeoutMs?: number;
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

async function runFetchPipeline(options: FetchPipelineOptions): Promise<void> {
  const { etlRoot, fetcher, processor } = resolveEtlRuntimePaths();
  const round = options.round === undefined ? '' : String(options.round);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

  fetchProcess.stdout?.pipe(processorProcess.stdin!);
  fetchProcess.stderr?.pipe(process.stderr);
  processorProcess.stdout?.pipe(process.stdout);
  processorProcess.stderr?.pipe(process.stderr);

  processorProcess.stdin?.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      console.error('ETL processor input failed:', error);
    }
  });

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`ETL fetch pipeline timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      Promise.all([
        waitForSuccessfulExit(fetchProcess, 'Footywire R fetcher'),
        waitForSuccessfulExit(processorProcess, 'Footywire Node processor'),
      ]),
      timeoutPromise,
    ]);
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

export { resolveEtlRuntimePaths, runFetchPipeline };
export type { EtlRuntimePaths, FetchPipelineOptions };
