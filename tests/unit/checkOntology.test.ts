import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const fixtureRoots: string[] = [];
const repositoryRoot = resolve(process.cwd());

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ontology validation command', () => {
  it('rejects a repository evidence location that does not exist', () => {
    const root = createOntologyFixture();
    const ontologyPath = join(root, 'config/ontology/statly.ontology.json');
    const ontology = JSON.parse(readFileSync(ontologyPath, 'utf8'));
    ontology.evidence[0].location = 'docs/does-not-exist.md';
    writeFileSync(ontologyPath, `${JSON.stringify(ontology, null, 2)}\n`, 'utf8');

    const result = spawnSync(process.execPath, ['Scripts/check-ontology.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'evidence:agents_guide: repository evidence location does not exist: docs/does-not-exist.md'
    );
  });
});

function createOntologyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'statly-ontology-check-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'Scripts'), { recursive: true });
  mkdirSync(join(root, 'config/ontology'), { recursive: true });
  writeFileSync(
    join(root, 'Scripts/check-ontology.mjs'),
    readFileSync(join(repositoryRoot, 'Scripts/check-ontology.mjs'))
  );
  for (const file of ['statly.ontology.json', 'statly.ontology.schema.json']) {
    writeFileSync(
      join(root, 'config/ontology', file),
      readFileSync(join(repositoryRoot, 'config/ontology', file))
    );
  }

  const ontology = JSON.parse(
    readFileSync(join(repositoryRoot, 'config/ontology/statly.ontology.json'), 'utf8')
  );
  for (const evidence of ontology.evidence) {
    const source = join(repositoryRoot, evidence.location);
    const destination = join(root, evidence.location);
    if (statSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
    } else {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, 'fixture evidence\n', 'utf8');
    }
  }
  return root;
}
