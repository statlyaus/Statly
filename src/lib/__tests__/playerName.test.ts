import { describe, it, expect } from 'vitest';
import {
  parsePlayerNameFromDocId,
  getCanonicalPlayerName,
  PlayerNameParseError,
} from '../playerName';

describe('playerName parsing', () => {
  it('parses ETL format with _ply_ slug', () => {
    const id = '2025-R3-GEE-WBD_ply_john_doe';
    expect(parsePlayerNameFromDocId(id)).toBe('John Doe');
  });

  it('parses simple <player>_<season>_<round> format', () => {
    const id = 'john_doe_2025_3';
    expect(parsePlayerNameFromDocId(id)).toBe('John Doe');
  });

  it('parses legacy <player>_20xx_* format', () => {
    const id = 'john_doe_2024_foo_bar';
    expect(parsePlayerNameFromDocId(id)).toBe('John Doe');
  });

  it('throws on malformed id', () => {
    const id = 'malformed-id-without-expected-structure';
    expect(() => parsePlayerNameFromDocId(id)).toThrow(PlayerNameParseError);
  });

  it('prefers canonical player_name from record when present', () => {
    const record = { player_name: 'Jane Smith' };
    const id = 'john_doe_2025_3';
    expect(getCanonicalPlayerName(record, id)).toBe('Jane Smith');
  });

  it('falls back to parsing docId when player_name missing', () => {
    const record = { other: true } as any;
    const id = 'john_doe_2025_3';
    expect(getCanonicalPlayerName(record, id)).toBe('John Doe');
  });
});
