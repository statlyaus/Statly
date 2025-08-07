/**
 * Represents a player in the system.
 * This is the canonical type definition for a player object.
 */
export interface Player {
  id: string;
  name: string;
  team: string;
  position?: string;
  stats?: Record<string, number | string>;
  // Individual stats for easier access if needed
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  hitouts?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s