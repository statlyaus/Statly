export type RosterPlayer = {
  id: string;
  name: string;
  position?: string;
  team?: string;
  stats?: Record<string, unknown>;
};
