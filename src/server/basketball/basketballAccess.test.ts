import { describe, expect, it } from 'vitest';

import { canUseBasketball } from './basketballAccess';

const env = (vars: Record<string, string | undefined>) => vars as unknown as NodeJS.ProcessEnv;

describe('canUseBasketball', () => {
  it('refuses a caller with no user id', () => {
    expect(canUseBasketball(null, env({ NODE_ENV: 'development' }))).toBe(false);
    expect(canUseBasketball(undefined, env({ NODE_ENV: 'development' }))).toBe(false);
    expect(canUseBasketball('', env({ NODE_ENV: 'development' }))).toBe(false);
  });

  it('is open to every signed-in user outside production when no list is set', () => {
    expect(canUseBasketball('anyone', env({ NODE_ENV: 'development' }))).toBe(true);
    expect(canUseBasketball('anyone', env({ NODE_ENV: 'test' }))).toBe(true);
    expect(
      canUseBasketball('anyone', env({ NODE_ENV: 'development', BASKETBALL_ALLOWED_USER_IDS: ' ' }))
    ).toBe(true);
  });

  it('is closed to everyone in production when no list is set', () => {
    expect(canUseBasketball('anyone', env({ NODE_ENV: 'production' }))).toBe(false);
    expect(
      canUseBasketball('anyone', env({ NODE_ENV: 'production', BASKETBALL_ALLOWED_USER_IDS: '' }))
    ).toBe(false);
  });

  it('admits only listed user ids once a list is set, in any environment', () => {
    const list = ' owner-uid , ,second-uid ';
    for (const NODE_ENV of ['production', 'development']) {
      const vars = env({ NODE_ENV, BASKETBALL_ALLOWED_USER_IDS: list });
      expect(canUseBasketball('owner-uid', vars)).toBe(true);
      expect(canUseBasketball('second-uid', vars)).toBe(true);
      expect(canUseBasketball('someone-else', vars)).toBe(false);
      expect(canUseBasketball('owner', vars)).toBe(false);
    }
  });
});
