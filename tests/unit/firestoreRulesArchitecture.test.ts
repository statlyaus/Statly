import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WRITE_OPERATIONS = new Set(['write', 'create', 'update', 'delete']);

interface AllowStatement {
  path: string;
  operations: string[];
  condition: string;
}

/** Reads every `allow` statement in `firestore.rules` with the full match path it sits under. */
function parseAllowStatements(source: string): AllowStatement[] {
  const scopes: (string | null)[] = [];
  const statements: AllowStatement[] = [];
  let pending: { operations: string[]; condition: string } | null = null;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();

    if (pending) {
      pending.condition += ` ${trimmed}`;
    } else if (trimmed.startsWith('allow ')) {
      const [, operations, condition] = trimmed.match(/^allow ([a-z, ]+): if (.*)$/) ?? [];
      if (!operations) throw new Error(`Unparsed allow statement: ${trimmed}`);
      pending = { operations: operations.split(',').map((op) => op.trim()), condition };
    }

    if (pending?.condition.endsWith(';')) {
      const path = scopes.filter((scope): scope is string => scope !== null).join('');
      statements.push({
        path: path.replace('/databases/{database}/documents', ''),
        operations: pending.operations,
        condition: pending.condition.slice(0, -1).trim(),
      });
      pending = null;
      continue;
    }

    const matchScope = trimmed.match(/^match (\S+) \{$/);
    if (matchScope) scopes.push(matchScope[1]);
    else if (trimmed.endsWith('{')) scopes.push(null);
    else if (trimmed === '}') scopes.pop();
  }

  return statements;
}

describe('Firestore rules architecture', () => {
  it('keeps root league document mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const leagueRootBlock = source.match(
      /match \/leagues\/\{leagueId\} \{\n\s+allow read: if isLeagueMember\(leagueId\);\n\s+allow write: if [^;]+;/
    )?.[0];

    expect(leagueRootBlock).toBeDefined();
    expect(leagueRootBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(leagueRootBlock).toContain('allow write: if false;');
    expect(leagueRootBlock).not.toContain('allow write: if isLeagueManager(leagueId);');
  });

  it('grants clients no write to any path except their own user documents', () => {
    const rules = parseAllowStatements(
      readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    );
    const writeGrants = rules.filter(
      (rule) =>
        rule.operations.some((operation) => WRITE_OPERATIONS.has(operation)) &&
        rule.condition !== 'false'
    );

    expect(rules.length).toBeGreaterThan(20);
    expect(writeGrants.map((rule) => rule.path)).toEqual([
      '/users/{userId}',
      '/users/{userId}/{document=**}',
    ]);
  });

  it('keeps roster lineups and member documents server-owned', () => {
    const rules = parseAllowStatements(
      readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    );

    for (const path of [
      '/leagues/{leagueId}/rosters/{teamId}',
      '/leagues/{leagueId}/members/{userId}',
    ]) {
      const pathRules = rules.filter((rule) => rule.path === path);
      expect(pathRules).toContainEqual({
        path,
        operations: ['read'],
        condition: 'isLeagueMember(leagueId)',
      });
      expect(pathRules).toContainEqual({ path, operations: ['write'], condition: 'false' });
      expect(pathRules).toHaveLength(2);
    }
  });

  it('keeps waiver mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const waiverBlock = source.match(/match \/waivers\/\{claimId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(waiverBlock).toBeDefined();
    expect(waiverBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(waiverBlock).toContain('allow create: if false;');
    expect(waiverBlock).toContain('allow update: if false;');
    expect(waiverBlock).toContain('allow delete: if false;');
  });

  it('keeps trade mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const tradeBlock = source.match(/match \/trades\/\{tradeId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(tradeBlock).toBeDefined();
    expect(tradeBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(tradeBlock).toContain('allow create: if false;');
    expect(tradeBlock).toContain('allow update: if false;');
    expect(tradeBlock).toContain('allow delete: if false;');
  });

  it('keeps team action mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const teamActionBlock = source.match(
      /match \/teamActions\/\{actionId\} \{[\s\S]*?\n\s{6}\}/
    )?.[0];

    expect(teamActionBlock).toBeDefined();
    expect(teamActionBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(teamActionBlock).toContain('allow create: if false;');
    expect(teamActionBlock).toContain('allow update: if false;');
    expect(teamActionBlock).toContain('allow delete: if false;');
  });

  it('keeps retired league watchlists inaccessible to clients', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const watchlistBlock = source.match(/match \/watchlists\/\{userId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(watchlistBlock).toBeDefined();
    expect(watchlistBlock).toContain('allow read, write: if false;');
    expect(watchlistBlock).not.toContain('allow read, write: if isLeagueMember(leagueId)');
  });

  it('keeps league config mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const configBlock = source.match(/match \/config\/\{configDoc\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(configBlock).toBeDefined();
    expect(configBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(configBlock).toContain('allow write: if false;');
    expect(configBlock).not.toContain('allow write: if isLeagueManager(leagueId);');
  });

  it('keeps league messages read-only until a send path exists', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const messageBlock = source.match(/match \/messages\/\{messageId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(messageBlock).toBeDefined();
    expect(messageBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(messageBlock).toContain('allow create: if false;');
    expect(messageBlock).toContain('allow update: if false;');
    expect(messageBlock).toContain('allow delete: if false;');
  });
});
