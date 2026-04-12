export const DRAFT_PICK_SECONDS_OPTIONS = [15, 30, 60, 90, 120, 180, 300] as const;

export type DraftPickSecondsOption = (typeof DRAFT_PICK_SECONDS_OPTIONS)[number];

export const MIN_DRAFT_PICK_SECONDS = DRAFT_PICK_SECONDS_OPTIONS[0];
export const MAX_DRAFT_PICK_SECONDS =
  DRAFT_PICK_SECONDS_OPTIONS[DRAFT_PICK_SECONDS_OPTIONS.length - 1];

export function isAllowedDraftPickSeconds(value: number): value is DraftPickSecondsOption {
  return DRAFT_PICK_SECONDS_OPTIONS.includes(value as DraftPickSecondsOption);
}

export function normalizeDraftPickSeconds(value: number): DraftPickSecondsOption {
  if (isAllowedDraftPickSeconds(value)) {
    return value;
  }

  return DRAFT_PICK_SECONDS_OPTIONS.reduce((closest, current) => {
    const currentDistance = Math.abs(current - value);
    const closestDistance = Math.abs(closest - value);
    return currentDistance < closestDistance ? current : closest;
  });
}

export function formatDraftPickSecondsLabel(value: number): string {
  switch (value) {
    case 15:
      return '15 seconds';
    case 30:
      return '30 seconds';
    case 60:
      return '1 minute';
    case 90:
      return '1.5 minutes';
    case 120:
      return '2 minutes';
    case 180:
      return '3 minutes';
    case 300:
      return '5 minutes';
    default:
      return `${value} seconds`;
  }
}
