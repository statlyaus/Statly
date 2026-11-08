import 'server-only';

/**
 * Fantasy basketball stays private until its NBA data is licensed for a public product (owner
 * decision, 2026-11-08; see docs/domain/basketball.md "Data source and licensing").
 *
 * `BASKETBALL_ALLOWED_USER_IDS` is a comma-separated list of Firebase user ids. When it is set, only
 * those users can open the section or call its API, in every environment. When it is unset the
 * section is open to signed-in users outside production (local development and e2e) and closed to
 * everyone in production. The list never leaves the server.
 */
export function canUseBasketball(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!userId) return false;
  const allowed = (env.BASKETBALL_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowed.length === 0) return env.NODE_ENV !== 'production';
  return allowed.includes(userId);
}
