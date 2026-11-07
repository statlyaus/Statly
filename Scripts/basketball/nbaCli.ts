/**
 * Shared argument parsing and the local-database guard for the NBA ingest scripts.
 */

export function parseArgs(
  argv: string[],
  spec: { flags: string[]; values: string[] }
): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index].replace(/^--/, '');
    if (spec.flags.includes(name)) options[name] = true;
    else if (spec.values.includes(name) && argv[index + 1] !== undefined)
      options[name] = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return options;
}

export function positiveInteger(
  value: string | boolean | undefined,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

/**
 * Refuses a non-local DATABASE_URL unless --allow-remote was passed. A remote database may be
 * production, so it is treated as production: the licensing guard (`assertNbaProviderAllowed`)
 * then refuses an unlicensed provider unless NBA_STATS_ALLOW_UNLICENSED_PROVIDER=true.
 */
export function assertLocalDatabase(allowRemote: boolean): void {
  const url = process.env.DATABASE_URL ?? '';
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (local) return;
  if (!allowRemote) {
    throw new Error('Refusing to use a non-local DATABASE_URL without --allow-remote.');
  }
  Object.assign(process.env, { NODE_ENV: 'production' });
}
