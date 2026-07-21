export const SOCIAL_COMPOSER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type SocialComposerSurface =
  | { type: 'league-chat' }
  | { type: 'draft-chat'; draftId: string };

export interface SocialComposerDraftScope {
  userId: string;
  leagueId: string;
  leagueSeasonId: string;
  surface: SocialComposerSurface;
  discussion?: { type: string; id: string };
}

export interface SocialComposerDraftRecord {
  value: string;
  attemptKey?: string;
  updatedAt: number;
}

interface ComposerDraftStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function keyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function getSocialComposerDraftKey(scope: SocialComposerDraftScope): string {
  const surface =
    scope.surface.type === 'draft-chat'
      ? `draft-chat:${keyPart(scope.surface.draftId)}`
      : 'league-chat';
  const discussion = scope.discussion
    ? `${keyPart(scope.discussion.type)}:${keyPart(scope.discussion.id)}`
    : 'general';

  return [
    'statly',
    'social-composer',
    'v1',
    keyPart(scope.userId),
    keyPart(scope.leagueId),
    keyPart(scope.leagueSeasonId),
    surface,
    discussion,
  ].join(':');
}

export function createSocialComposerAttemptKey(prefix = 'chat'): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

export function readSocialComposerDraft(
  storage: ComposerDraftStorage,
  key: string,
  now = Date.now()
): SocialComposerDraftRecord | null {
  try {
    const serialized = storage.getItem(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as Partial<SocialComposerDraftRecord>;
    if (
      typeof parsed.value !== 'string' ||
      typeof parsed.updatedAt !== 'number' ||
      !Number.isFinite(parsed.updatedAt)
    ) {
      storage.removeItem(key);
      return null;
    }
    if (now - parsed.updatedAt > SOCIAL_COMPOSER_DRAFT_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return {
      value: parsed.value,
      updatedAt: parsed.updatedAt,
      ...(typeof parsed.attemptKey === 'string' ? { attemptKey: parsed.attemptKey } : {}),
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeSocialComposerDraft(
  storage: ComposerDraftStorage,
  key: string,
  draft: Pick<SocialComposerDraftRecord, 'value' | 'attemptKey'>,
  now = Date.now()
): void {
  if (!draft.value) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(
    key,
    JSON.stringify({
      value: draft.value,
      updatedAt: now,
      ...(draft.attemptKey ? { attemptKey: draft.attemptKey } : {}),
    } satisfies SocialComposerDraftRecord)
  );
}

export function clearSocialComposerDraft(storage: ComposerDraftStorage, key: string): void {
  storage.removeItem(key);
}
