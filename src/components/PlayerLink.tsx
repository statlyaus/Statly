'use client';

import { type ReactNode } from 'react';

import Link from 'next/link';

interface PlayerLinkProps {
  playerName: string;
  playerId?: string;
  children?: ReactNode;
  className?: string;
  showTooltip?: boolean;
}

export default function PlayerLink({
  playerName,
  playerId,
  children,
  className = 'text-info hover:text-info hover:underline',
  showTooltip = false,
}: PlayerLinkProps) {
  const targetId = encodeURIComponent(playerId ?? playerName);

  return (
    <Link
      href={`/players/${targetId}`}
      className={className}
      title={showTooltip ? `View ${playerName}'s profile` : undefined}
    >
      {children || playerName}
    </Link>
  );
}
