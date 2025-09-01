// src/lib/playerPositionMapping.ts

/**
 * Normalize any AFL position code into one of DEF, MID, RUC, FWD
 */
export function getPlayerPosition(key: string): 'DEF' | 'MID' | 'RUC' | 'FWD' | 'UNK' {
  switch (key.toUpperCase()) {
    case 'D':
    case 'DEF':
    case 'DEFENDER':
      return 'DEF';
    case 'M':
    case 'MID':
    case 'MIDFIELDER':
      return 'MID';
    case 'R':
    case 'RUC':
    case 'RUCK':
      return 'RUC';
    case 'F':
    case 'FWD':
    case 'FORWARD':
      return 'FWD';
    default:
      return 'UNK';
  }
}