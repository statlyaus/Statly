"use client";

import { useEffect, useMemo, useState } from 'react';
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

  const currentId = leagueId && leagues.some((l) => l.id === leagueId) ? leagueId : undefined;

  const onChange = (nextId: string) => {
    if (!nextId) return;
    setLastLeagueId(nextId);
    const qs = search?.toString();
    const suffix = qs && qs.length > 0 ? `?${qs}` : '';
    if (tail != null && tail !== '') {
      router.push(`/leagues/${nextId}${tail}${suffix}`);
    } else {
      router.push(`/leagues/${nextId}${suffix}`);
    }
  };

  // Render select
  return (
    <div className="inline-flex items-center gap-2">
      <label htmlFor="league-switcher" className="sr-only">Select league</label>
      <select
        id="league-switcher"
        value={currentId || ''}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 text-sm border border-neutral-300 rounded bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        aria-label="Select league"
      >
        {!currentId && <option value="" disabled>{loading ? 'Loading leagues…' : 'Select a league'}</option>}
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </div>
  );
}
