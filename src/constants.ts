// Shared application constants

// Default match UID used in demos and initial state
export const DEFAULT_UID = '2025-R18-ADE-COL';

// Player count above which virtualization should be enabled
const parsedThreshold = parseInt(process.env.NEXT_PUBLIC_VIRTUALIZE_THRESHOLD || '100', 10);
export const VIRTUALIZE_THRESHOLD = Number.isFinite(parsedThreshold) ? parsedThreshold : 100;
