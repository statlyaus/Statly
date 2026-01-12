"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/AuthContext';

interface LeagueLite { id: string; name: string }

function extractLeagueContext(pathname: string): { base: string; leagueId?: string; tail?: string } {
  // Matches /leagues/:id or /leagues/:id/...; captures id and tail
  const m = pathname.match(/^\/(leagues)\/([^\/]+)(\/.*)?$/);
  if (m) {
    return { base: m[1], leagueId: m[2], tail: m[3] || '' };
  }
  return { base: '', leagueId: undefined, tail: '' };
}

export default function LeagueSwitcher() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const menuRef = useRef<HTMLDivElement | null>(null);

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
  const [lastLeagueId, setLastLeagueId] = useLocalStorage<string>('ui.lastLeagueId', '');
  const [isOpen, setIsOpen] = useState(false);

  // Auto-navigate to last selected league if on /leagues with no id
  useEffect(() => {
    if (!pathname) return;
    const isLeaguesRoot = /^\/leagues\/?$/.test(pathname);
    if (!isLeaguesRoot) return;
    if (!lastLeagueId) return;
    if (!leagues.some((l) => l.id === lastLeagueId)) return;
    const qs = search?.toString();
    const suffix = qs && qs.length > 0 ? `?${qs}` : '';
    router.replace(`/leagues/${lastLeagueId}${suffix}`);
  }, [pathname, lastLeagueId, leagues, router, search]);

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
        if (mounted) setLeagues(list.map((l: any) => ({ id: l.id, name: l.name })));
      } catch (e) {
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
    if (!pathname?.startsWith('/leagues')) return;
    const qs = search?.toString();
    const suffix = qs && qs.length > 0 ? `?${qs}` : '';
    if (tail != null && tail !== '') {
      router.push(`/leagues/${nextId}${tail}${suffix}`);
    } else {
      router.push(`/leagues/${nextId}${suffix}`);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const currentLeague = leagues.find((l) => l.id === currentId);
  const buttonLabel = currentLeague?.name ?? (loading ? 'Loading leagues…' : 'Select a league');

  // Render select
  return (
    <div className="relative inline-flex items-center gap-2" ref={menuRef}>
      <label htmlFor="league-switcher" className="sr-only">Select league</label>
      <button
        id="league-switcher"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold border border-black rounded bg-black text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="truncate max-w-[240px]">{buttonLabel}</span>
        <span className="text-xs">{isOpen ? '▴' : '▾'}</span>
      </button>
      {isOpen && (
        <div
          role="listbox"
          aria-label="Select league"
          className="absolute left-0 top-full z-50 mt-2 min-w-full rounded-md border border-black bg-black shadow-lg"
        >
          {leagues.length === 0 ? (
            <div className="px-3 py-2 text-sm text-blue-400">
              {loading ? 'Loading leagues…' : 'No leagues found'}
            </div>
          ) : (
            leagues.map((league) => {
              const isActive = league.id === currentId;
              return (
                <button
                  key={league.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(league.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    isActive ? 'bg-blue-950 text-blue-200' : 'text-blue-400 hover:bg-blue-950'
                  }`}
                >
                  <span className="truncate">{league.name}</span>
                  {isActive ? <span className="text-xs">✓</span> : null}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
