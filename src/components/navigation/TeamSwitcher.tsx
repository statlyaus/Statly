'use client';

import { useMemo, useState } from 'react';

import { Check, ChevronDown } from 'lucide-react';

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
import { useTeamContext } from '@/contexts/TeamContext';

export default function TeamSwitcher() {
  const { teams, activeLeague, activeMember, switchTeam, loading } = useTeamContext();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const teamOptions = teams ?? [];

  const filteredTeams = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return teamOptions;
    return teamOptions.filter((team) => {
      const leagueLabel = `league ${team.leagueId.slice(0, 8)}`.toLowerCase();
      return (
        (team.teamName || team.memberId.slice(0, 8)).toLowerCase().includes(normalizedQuery) ||
        leagueLabel.includes(normalizedQuery)
      );
    });
  }, [query, teamOptions]);

  const activeTeam = teamOptions.find(
    (team) => activeLeague === team.leagueId && activeMember === team.memberId
  );

  if (teamOptions.length === 0) return null;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setQuery('');
    }
  };

  return (
    <div className="relative inline-block text-left">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium hover:bg-gray-200">
          <span className="max-w-[180px] truncate">
            {activeTeam?.teamName ||
              (activeLeague ? `League ${activeLeague.slice(0, 6)}…` : 'Select Team')}
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command>
            <div className="p-2">
              <CommandInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search teams..."
              />
            </div>
            <CommandList>
              {loading ? (
                <CommandEmpty>Loading teams…</CommandEmpty>
              ) : filteredTeams.length === 0 ? (
                <CommandEmpty>No teams found</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredTeams.map((team) => {
                    const isActive =
                      activeLeague === team.leagueId && activeMember === team.memberId;

                    return (
                      <CommandItem
                        key={`${team.leagueId}:${team.memberId}`}
                        onClick={() => {
                          switchTeam(team.leagueId, team.memberId);
                          handleOpenChange(false);
                        }}
                        className={isActive ? 'bg-accent text-accent-foreground' : undefined}
                        aria-selected={isActive}
                      >
                        <div>
                          <div className="font-medium">
                            {team.teamName || team.memberId.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            League {team.leagueId.slice(0, 8)}
                          </div>
                        </div>
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
