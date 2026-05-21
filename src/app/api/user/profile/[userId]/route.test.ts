import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const getUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/services/userProfileService', () => ({
  userProfileService: {
    getUserProfile: getUserProfileMock,
    updateUserProfile: updateUserProfileMock,
  },
}));

const context = (userId: string) => ({ params: Promise.resolve({ userId }) });

describe('/api/user/profile/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    getUserProfileMock.mockResolvedValue({ id: 'user-1', displayName: 'User One' });
    updateUserProfileMock.mockResolvedValue({ id: 'user-1', displayName: 'Updated' });
  });

  it('rejects unauthenticated profile reads', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-1'),
      context('user-1')
    );

    expect(response.status).toBe(401);
    expect(getUserProfileMock).not.toHaveBeenCalled();
  });

  it('rejects reads for a different user id', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-2'),
      context('user-2')
    );

    expect(response.status).toBe(403);
    expect(getUserProfileMock).not.toHaveBeenCalled();
  });

  it('allows a user to read their own profile', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/user-1'),
      context('user-1')
    );

    expect(response.status).toBe(200);
    expect(getUserProfileMock).toHaveBeenCalledWith('user-1');
  });

  it('rejects updates for a different user id', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const { PUT } = await import('./route');

    const response = await PUT(
      new NextRequest('http://localhost/api/user/profile/user-2', {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'Bad Update' }),
      }),
      context('user-2')
    );

    expect(response.status).toBe(403);
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });
});
