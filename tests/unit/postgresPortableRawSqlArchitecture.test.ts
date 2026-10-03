import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Hand-written SQL must run on PostgreSQL (#744): it folds unquoted names to lower case, so Prisma's
// mixed-case tables and columns must be double-quoted, and SQLite-only syntax is not available.
const rawSqlFiles = execFileSync(
  'git',
  ['grep', '-l', '-E', String.raw`\$(queryRaw|executeRaw)|Prisma\.sql`, '--', 'src', 'etl'],
  {
    encoding: 'utf8',
  }
)
  .split('\n')
  .filter((path) => path && !/\.test\.tsx?$/.test(path));

const rawSqlBodies = (source: string) =>
  [...source.matchAll(/(?:\$(?:queryRaw|executeRaw)(?:<[^`]*?>)?|Prisma\.sql)`([^`]*)`/g)].map(
    ([, body]) =>
      (body ?? '')
        .replace(/\$\{[^}]*\}/g, '?')
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
  );

const problems = (sql: string) =>
  [
    [
      /\b(datetime|strftime|json_extract)\s*\(|\bINSERT\s+OR\b|\bPRAGMA\b|\bsqlite_master\b/i,
      'SQLite-only syntax',
    ],
    [/\bALTER\s+TABLE\b/i, 'schema change at runtime'],
    [/\b[a-z]\w*[A-Z]\w*\b/, 'unquoted mixed-case column'],
    [/\b(FROM|JOIN|UPDATE|INTO)\s+[A-Z]\w*/, 'unquoted table'],
  ]
    .filter(([pattern]) => (pattern as RegExp).test(sql))
    .map(([, reason]) => reason as string);

describe('raw SQL portability', () => {
  it('finds the raw SQL it is guarding', () => {
    expect(rawSqlFiles.length).toBeGreaterThan(0);
  });

  it('keeps every hand-written query runnable on PostgreSQL', () => {
    const offences = rawSqlFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const unsafe = /\$(queryRaw|executeRaw)Unsafe\b/.test(source)
        ? [`${path}: string-built SQL`]
        : [];
      return [
        ...unsafe,
        ...rawSqlBodies(source).flatMap((sql) =>
          problems(sql).map((reason) => `${path}: ${reason}: ${sql.replace(/\s+/g, ' ').trim()}`)
        ),
      ];
    });

    expect(offences).toEqual([]);
  });
});
