import { disconnectDevFixtureRunner, parseDevFixtureCliArgs, runDevFixtures } from '../core/runner';
import type { DevFixtureCliOptions } from '../core/types';

let options: DevFixtureCliOptions | null = null;
async function main() {
  options = parseDevFixtureCliArgs(process.argv.slice(2));
  const output = await runDevFixtures(options);
  console.log(output);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (options?.command !== 'list') {
      await disconnectDevFixtureRunner();
      process.exit(process.exitCode ?? 0);
    }
  });
