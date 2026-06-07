'use client';

import { useEffect, useMemo, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';

import { useAuth } from '@/AuthContext';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui';
import { buildPreferenceCookie, LAST_LEAGUE_ID_COOKIE, readCookieValue } from '@/lib/uiPreferences';

interface LeagueLite {
  id: string;
  name: string;
}

const RESERVED_LEAGUE_ROUTES = new Set(['join', 'new']);

function extractLeagueContext(pathname: string): {
  base: string;
  leagueId?: string;
  tail?: string;
} {
  // Matches /leagues/:id or /leagues/:id/...; captures id and tail
  const m = pathname.match(/^\/(leagues)\/([^/]+)(\/.*)?$/);
  if (m) {
    if (RESERVED_LEAGUE_ROUTES.has(m[2])) {
      return { base: m[1], leagueId: undefined, tail: '' };
    }
    return { base: m[1], leagueId: m[2], tail: m[3] || '' };
  }
  return { base: '', leagueId: undefined, tail: '' };
}

export default function LeagueSwitcher() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  const [{ leagueId, tail }, setRouteCtx] = useState(() => {
    const ctx = extractLeagueContext(pathname || '/');
    return { leagueId: ctx.leagueId, tail: ctx.tail };
  });

  useEffect(() => {
    const ctx = extractLeagueContext(pathname || '/');
    setRouteCtx({ leagueId: ctx.leagueId, tail: ctx.tail });
  }, [pathname]);

  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLeagueId, setLastLeagueId] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cookieLeagueId = readCookieValue(document.cookie, LAST_LEAGUE_ID_COOKIE) ?? '';
    setLastLeagueId((currentLeagueId) =>
      currentLeagueId === cookieLeagueId ? currentLeagueId : cookieLeagueId
    );
  }, []);

  useEffect(() => {
    if (!leagueId || typeof document === 'undefined') return;
    if (lastLeagueId === leagueId) return;
    setLastLeagueId(leagueId);
    document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, leagueId);
  }, [lastLeagueId, leagueId]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (!user) {
          setLeagues([]);
          setLoading(false);
          return;
        }
        setLoading(true);
        const r = await fetch(`/api/leagues/user/${user.uid}`);
        const j = await r.json();
        const list = Array.isArray(j) ? j : j?.leagues ? j.leagues : j?.data?.leagues || [];
        if (mounted)
          setLeagues(list.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
      } catch (_e) {
        if (mounted) setLeagues([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [user]);

  const currentId =
    (leagueId && leagues.some((l) => l.id === leagueId) ? leagueId : undefined) ||
    (lastLeagueId && leagues.some((l) => l.id === lastLeagueId) ? lastLeagueId : undefined);

  const onChange = (nextId: string) => {
    if (!nextId) return;
    setLastLeagueId(nextId);
    if (typeof document !== 'undefined') {
      document.cookie = buildPreferenceCookie(LAST_LEAGUE_ID_COOKIE, nextId);
    }
    if (pathname?.startsWith('/leagues')) {
      const qs = search?.toString();
      const suffix = qs && qs.length > 0 ? `?${qs}` : '';
      if (tail != null && tail !== '') {
        router.push(`/leagues/${nextId}${tail}${suffix}`);
      } else {
        router.push(`/leagues/${nextId}${suffix}`);
      }
      return;
    }

    router.push(`/leagues/${nextId}`);
  };

  const currentLeague = leagues.find((l) => l.id === currentId);
  const buttonLabel = currentLeague?.name ?? (loading ? 'Loading leagues…' : 'Select a league');
  const filteredLeagues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return leagues;
    return leagues.filter((league) => league.name.toLowerCase().includes(normalizedQuery));
  }, [leagues, query]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setQuery('');
    }
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <label htmlFor="league-switcher-search" className="sr-only">
        Select league
      </label>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger className="flex items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 py-2 text-sm font-semibold text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]">
          <span className="max-w-[240px] truncate">{buttonLabel}</span>
          <ChevronDown
            className={`h-4 w-4 text-[color:var(--league-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </PopoverTrigger>
        <PopoverContent
          aria-label="Select league"
          className="min-w-[20rem] rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-0 text-[color:var(--league-text)] shadow-[0_24px_60px_-35px_rgba(23,34,48,0.22)]"
        >
          <Command className="bg-[color:var(--league-surface)] text-[color:var(--league-text)]">
            <div className="p-2">
              <CommandInput
                id="league-switcher-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search leagues..."
                className="border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)] placeholder:text-[color:var(--league-text-muted)]"
              />
            </div>
            <CommandList>
              {loading ? (
                <CommandEmpty>Loading leagues…</CommandEmpty>
              ) : filteredLeagues.length === 0 ? (
                <CommandEmpty>
                  {leagues.length === 0 ? 'No leagues found' : 'No matches found'}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredLeagues.map((league) => {
                    const isActive = league.id === currentId;
                    return (
                      <CommandItem
                        key={league.id}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          onChange(league.id);
                          setIsOpen(false);
                          setQuery('');
                        }}
                        className={
                          isActive
                            ? 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)] hover:bg-[color:var(--league-primary-soft)]'
                            : 'text-[color:var(--league-text)] hover:bg-[color:var(--league-surface-muted)]'
                        }
                      >
                        <span className="truncate">{league.name}</span>
                        {isActive ? <Check className="h-4 w-4" /> : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
