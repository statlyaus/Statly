'use client';

import Link from 'next/link';
import { ReactNode } from 'react';

interface PlayerLinkProps {
  playerName: string;
  playerId?: string;
  children?: ReactNode;
  className?: string;
  showArrow?: boolean;
}

export default function PlayerLink({ 
  playerName, 
  playerId, 
  children, 
  className = "text-blue-600 hover:text-blue-800 hover:underline transition-colors",
  showArrow = false 
}: PlayerLinkProps) {
  // Use playerId if available, otherwise use player name
  const href = `/players/${encodeURIComponent(playerId || playerName)}`;
  
  return (
    <Link href={href} className={className}>
      {children || playerName}
      {showArrow && <span className="ml-1">→</span>}
    </Link>
  );
}
