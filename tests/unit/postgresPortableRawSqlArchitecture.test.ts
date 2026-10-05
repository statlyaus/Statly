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

// Index just past the `}` closing an expression that starts at `from`, skipping nested braces, strings
// and template literals, so a nested template cannot end the enclosing SQL body early.
function skipExpression(source: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '`') i = skipTemplate(source, i + 1) - 1;
    else if (char === "'" || char === '"') i = source.indexOf(char, i + 1);
    i += 1;
  }
  return i;
}

// Index just past the backtick closing a template whose body starts at `from`.
function skipTemplate(source: string, from: number): number {
  let i = from;
  while (i < source.length && source[i] !== '`') {
    i = source.startsWith('${', i) ? skipExpression(source, i + 2) : i + 1;
  }
  return i + 1;
}

// Each raw SQL template body, with every interpolation reduced to `?` and string and quoted-identifier
// contents removed, so only the SQL the database parses as names and keywords is checked.
const rawSqlBodies = (source: string) =>
  [...source.matchAll(/(?:\$(?:queryRaw|executeRaw)(?:<[^`]*?>)?|Prisma\.sql)`/g)].map((match) => {
    let body = '';
    let i = (match.index ?? 0) + match[0].length;
    while (i < source.length && source[i] !== '`') {
      if (source.startsWith('${', i)) {
        body += '?';
        i = skipExpression(source, i + 2);
      } else {
        body += source[i];
        i += 1;
      }
    }
    return body.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  });

const problems = (sql: string) =>
  [
    [
      /\b(datetime|strftime|json_extract)\s*\(|\bINSERT\s+OR\b|\bPRAGMA\b|\bsqlite_master\b/i,
      'SQLite-only syntax',
    ],
    [/\bALTER\s+TABLE\b/i, 'schema change at runtime'],
    [/\b[a-z]\w*[A-Z]\w*\b/, 'unquoted mixed-case column'],
    // Any unquoted name after these keywords, in either case; quoted names are already reduced to "".
    [/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?!SET\b)[A-Za-z_]\w*/i, 'unquoted table'],
  ]
    .filter(([pattern]) => (pattern as RegExp).test(sql))
    .map(([, reason]) => reason as string);

describe('raw SQL portability', () => {
  it('finds the raw SQL it is guarding', () => {
    expect(rawSqlFiles.length).toBeGreaterThan(0);
  });

  it('flags an unquoted table after a lowercase keyword', () => {
    expect(problems('select * from User where ""= ?')).toContain('unquoted table');
    expect(
      problems('INSERT INTO "" ("") VALUES (?) ON CONFLICT ("") DO UPDATE SET "" = ?')
    ).toEqual([]);
  });

  it('scans past a nested template literal to the end of the SQL body', () => {
    const [body] = rawSqlBodies(
      'prisma.$executeRaw`VALUES (${`${a}:${b}`}, ${c}) ON CONFLICT DO UPDATE SET leagueId = 1`'
    );
    expect(body).toBe('VALUES (?, ?) ON CONFLICT DO UPDATE SET leagueId = 1');
    expect(problems(body ?? '')).toContain('unquoted mixed-case column');
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
