import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

describe('agent skill validation command', () => {
  it('rejects a locked skill whose root directory is a symbolic link', () => {
    const root = createSkillsFixture();
    const relocatedSkill = join(root, '.outside/ask-matt');
    mkdirSync(dirname(relocatedSkill), { recursive: true });
    renameSync(join(root, '.agents/skills/ask-matt'), relocatedSkill);
    symlinkSync('../../.outside/ask-matt', join(root, '.agents/skills/ask-matt'), 'dir');

    const result = spawnSync(process.execPath, ['Scripts/check-agent-skills.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '.agents/skills/ask-matt: symbolic links are prohibited in locked skills'
    );
  });

  it('rejects a symbolic link inside locked upstream skill content', () => {
    const root = createSkillsFixture();
    symlinkSync('SKILL.md', join(root, '.agents/skills/ask-matt/linked-skill.md'));

    const result = spawnSync(process.execPath, ['Scripts/check-agent-skills.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '.agents/skills/ask-matt/linked-skill.md: symbolic links are prohibited in locked skills'
    );
  });
});

function createSkillsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'statly-agent-skills-check-'));
  fixtureRoots.push(root);

  copyDirectory(root, '.agents/skills');
  for (const file of [
    'AGENTS.md',
    'skills-lock.json',
    'docs/agents/domain.md',
    'docs/agents/issue-tracker.md',
    'docs/agents/setup-matt-pocock-skills.md',
    'docs/agents/skill-routing.md',
    'docs/development/delivery.md',
    'Scripts/check-agent-skills.mjs',
  ]) {
    copyFile(root, file);
  }

  return root;
}

function copyDirectory(root: string, relativePath: string): void {
  cpSync(join(repositoryRoot, relativePath), join(root, relativePath), { recursive: true });
}

function copyFile(root: string, relativePath: string): void {
  const destination = join(root, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(join(repositoryRoot, relativePath)));
}
