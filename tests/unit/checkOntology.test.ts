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
  it('accepts the valid ontology fixture', () => {
    const result = runOntologyCheck(createOntologyFixture());

    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'Ontology checks passed: 31 nodes, 28 symbolic statements, 3 hypotheses, and 3 lineages.\n',
    });
  });

  it('rejects a repository evidence location that does not exist', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.evidence[0].location = 'docs/does-not-exist.md';
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (1):\n' +
        '- evidence:agents_guide: repository evidence location does not exist: docs/does-not-exist.md\n',
      stdout: '',
    });
  });

  it('rejects Windows absolute and environment-file evidence locations', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.evidence[0].kind = 'runtime_observation';
      ontology.evidence[0].location = 'C:\\Users\\alice\\.env.production';
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (2):\n' +
        '- evidence:agents_guide: absolute paths are prohibited\n' +
        '- evidence:agents_guide: environment files are prohibited\n',
      stdout: '',
    });
  });

  it('reports schema and ontology collection failures in validation order', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.nodes = {};
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (2):\n' +
        '- $.nodes: expected array\n' +
        '- nodes must be an array\n',
      stdout: '',
    });
  });

  it('rejects schema composition violations at the command boundary', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.hypotheses[0].probability = 0.5;
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (2):\n' +
        '- $.hypotheses[0].probability: number is below 0.8\n' +
        '- hypothesis:route_tree_maps_to_domain_modules: probability does not match high calibration\n',
      stdout: '',
    });
  });

  it('rejects a hypothesis with no supporting or contradicting evidence', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.hypotheses[0].supportingEvidence = [];
      ontology.hypotheses[0].contradictingEvidence = [];
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (1):\n' +
        '- hypothesis:route_tree_maps_to_domain_modules: at least one evidence item is required\n',
      stdout: '',
    });
  });

  it('reports malformed hypothesis evidence without an uncaught exception', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.hypotheses[0].supportingEvidence = {};
      ontology.hypotheses[0].contradictingEvidence = [];
    });

    const result = runOntologyCheck(root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('$.hypotheses[0].supportingEvidence: expected array');
    expect(result.stderr).not.toContain('TypeError');
  });

  it('rejects lineage that does not consume all declared evidence', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.lineages[0].steps[0].inputs = ['evidence:server_tree'];
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (1):\n' +
        '- hypothesis:route_tree_maps_to_domain_modules: lineage does not consume declared evidence evidence:app_route_tree\n',
      stdout: '',
    });
  });

  it('reports malformed lineage steps without an uncaught exception', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.lineages[0].steps = {};
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (2):\n' +
        '- $.lineages[0].steps: expected array\n' +
        '- lineage:route_to_module_semantics: lineage has no steps\n',
      stdout: '',
    });
  });

  it('reports malformed lineage step inputs without an uncaught exception', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      ontology.lineages[0].steps[0].inputs = {};
    });

    const result = runOntologyCheck(root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('$.lineages[0].steps[0].inputs: expected array');
    expect(result.stderr).not.toContain('TypeError');
  });

  it('rejects a protected statement whose meaning changes', () => {
    const root = createOntologyFixture();
    mutateOntology(root, (ontology) => {
      const statement = ontology.symbolicStatements.find(
        ({ id }: { id: string }) => id === 'statement:prisma_owns_protected_state'
      );
      statement.object = 'concept:identity';
    });

    const result = runOntologyCheck(root);

    expect(result).toEqual({
      status: 1,
      stderr:
        'Ontology checks failed (1):\n' +
        '- statement:prisma_owns_protected_state: protected statement has changed meaning\n',
      stdout: '',
    });
  });
});

function runOntologyCheck(root: string) {
  const result = spawnSync(process.execPath, ['Scripts/check-ontology.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function mutateOntology(root: string, mutate: (ontology: any) => void): void {
  const ontologyPath = join(root, 'config/ontology/statly.ontology.json');
  const ontology = JSON.parse(readFileSync(ontologyPath, 'utf8'));
  mutate(ontology);
  writeFileSync(ontologyPath, `${JSON.stringify(ontology, null, 2)}\n`, 'utf8');
}

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
