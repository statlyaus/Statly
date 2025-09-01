// Centralized validation utilities

/**
 * Validate that a provided value is a league identifier we accept.
 * Accepts either a UUID v4 string or a numeric string.
 */
export const isValidLeagueId = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  if (!id) return false;
  const isUuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
  const isNumeric = /^\d+$/.test(id);
  return isUuidV4 || isNumeric;
};
