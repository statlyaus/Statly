// Firebase Data Connect SDK placeholder
// This will be replaced when Data Connect operations are generated
export const __STATLY_DC_PLACEHOLDER__ = true;

export async function listLivePlayerStats() {
  throw new Error(
    'Firebase Data Connect is not configured. This feature requires Data Connect setup. Falling back to standard Firestore queries.'
  );
}

export { listLivePlayerStats as ListLivePlayerStats };

export default {
  __STATLY_DC_PLACEHOLDER__,
  listLivePlayerStats,
  ListLivePlayerStats: listLivePlayerStats,
};
