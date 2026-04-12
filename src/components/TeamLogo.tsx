'use client';

import Image from 'next/image';

import { getTeamLogo, normalizeTeamName } from '@/lib/teamLogos';

type TeamLogoProps = {
  team?: string | null;
  size?: number;
  decorative?: boolean;
  withCircle?: boolean;
  className?: string;
};

export function TeamLogo({
  team,
  size = 20,
  decorative = true,
  withCircle = false,
  className = '',
}: TeamLogoProps) {
  const safeTeam = normalizeTeamName(team ?? '');
  const alt = decorative ? '' : `${safeTeam || 'Team'} logo`;
  const src = getTeamLogo(safeTeam);
  /** Local club SVGs are Illustrator exports; skip the image optimizer (no raster pipeline for SVG). */
  const unoptimized = src.endsWith('.svg');

  const img = (
    <Image
      src={src}
      alt={alt}
      aria-hidden={decorative ? 'true' : undefined}
      width={size}
      height={size}
      unoptimized={unoptimized}
      className={`object-contain shrink-0 ${className}`}
    />
  );

  if (!withCircle) return img;

  return (
    <span className="inline-flex items-center justify-center rounded-full bg-slate-100 ring-1 ring-slate-200">
      {img}
    </span>
  );
}

export default TeamLogo;
