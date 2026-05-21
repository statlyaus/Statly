'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/AuthContext';
import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';
import type { LeagueMember } from '@/types/leagues';

interface LeagueWaiversTabProps {
  leagueId: string;
  members: LeagueMember[];
  preselectedClaimPlayerId?: string;
  embedded?: boolean;
}

interface PlayerLite {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number;
}

interface PlayersResponse {
  items?: PlayerLite[];
  nextCursor?: string | null;
}

interface WaiverSettingsResponse {
  waiverSettings?: {
    system?: 'FAAB' | 'PRIORITY' | 'ROLLING_LIST' | 'FREE_AGENCY';
    faabBudget?: number;
    minimumBid?: number;
  } | null;
}

export default function LeagueWaiversTab({
  leagueId,
  members,
  preselectedClaimPlayerId,
  embedded = false,
}: LeagueWaiversTabProps) {
  const { user } = useAuth();
  const [availablePlayers, setAvailablePlayers] = useState<PlayerLite[]>([]);
  const [playersIndex, setPlayersIndex] = useState<
    Record<string, { id: string; name: string; team?: string; position?: string }>
  >({});
  const [initialSettings, setInitialSettings] = useState<{
    waiverSettings?: { faabBudget?: number; minimumBid?: number };
  } | null>(null);
  const [initialPlayersCursor, setInitialPlayersCursor] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;

    const bootstrapPlayers = async () => {
      try {
        const token =
          user && typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
        const [playersResponse, settingsResponse] = await Promise.all([
          fetch(`/api/leagues/${leagueId}/players?limit=100&owned=false`, {
            credentials: 'include',
            headers: authHeaders,
          }),
          fetch(`/api/leagues/${leagueId}/waivers/settings`, {
            credentials: 'include',
            headers: authHeaders,
          }),
        ]);
        if (!active) return;

        if (settingsResponse.ok) {
          const settingsData = (await settingsResponse.json()) as WaiverSettingsResponse;
          setInitialSettings({
            waiverSettings: settingsData.waiverSettings
              ? {
                  faabBudget: settingsData.waiverSettings.faabBudget,
                  minimumBid: settingsData.waiverSettings.minimumBid,
                }
              : undefined,
          });
        }

        const hydratePlayers = (items: PlayerLite[], nextCursor: string | null | undefined) => {
          setAvailablePlayers(
            items.filter((p) => (typeof p.ownership === 'number' ? p.ownership < 100 : true))
          );
          setPlayersIndex(
            Object.fromEntries(
              items.map((player) => [
                player.id,
                {
                  id: player.id,
                  name: player.name,
                  team: player.team,
                  position: player.position,
                },
              ])
            )
          );
          setInitialPlayersCursor(nextCursor ?? null);
        };

        const parsePlayers = async (response: Response) => {
          const data = (await response.json()) as PlayersResponse;
          return {
            items: Array.isArray(data.items) ? data.items : [],
            nextCursor: data.nextCursor,
          };
        };

        if (playersResponse.ok) {
          const data = await parsePlayers(playersResponse);
          if (data.items.length > 0 || data.nextCursor) {
            hydratePlayers(data.items, data.nextCursor);
            return;
          }
        }

        // Fallback path: load an unfiltered page and derive claimable players client-side.
        const fallbackResponse = await fetch(`/api/leagues/${leagueId}/players?limit=100`, {
          credentials: 'include',
          headers: authHeaders,
        });
        if (!fallbackResponse.ok) return;
        const fallbackData = await parsePlayers(fallbackResponse);
        const fallbackItems = fallbackData.items;
        hydratePlayers(fallbackItems, fallbackData.nextCursor);
      } catch (error) {
        console.error('Failed to bootstrap waiver players', error);
      } finally {
        if (active) setIsBootstrapping(false);
      }
    };

    void bootstrapPlayers();
    return () => {
      active = false;
    };
  }, [leagueId, user]);

  const membersIndex = useMemo(
    () =>
      Object.fromEntries(
        members.map((member) => [
          member.userId,
          { userId: member.userId, teamName: member.teamName, teamId: member.id },
        ])
      ),
    [members]
  );

  if (isBootstrapping) {
    return <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Loading waivers…</div>;
  }

  return (
    <LeagueWaiversContainer
      leagueId={leagueId}
      embedded={embedded}
      disableRealtime
      initialSettings={initialSettings ?? undefined}
      availablePlayers={availablePlayers}
      playersIndex={playersIndex}
      membersIndex={membersIndex}
      initialPlayersCursor={initialPlayersCursor}
      preselectedClaimPlayerId={preselectedClaimPlayerId}
    />
  );
}
