import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEAM_SYMBOL_POSITION,
  MAX_TEAM_SYMBOL_DATA_URL_LENGTH,
  normalizeTeamSymbolPosition,
  normalizeTeamSymbolUrl,
} from '@/lib/teamSymbol';

const INVALID_TEAM_SYMBOL_MESSAGE =
  'Team symbol must be an http(s) URL or a PNG, JPEG, or WebP data URL';

describe('team symbol validation', () => {
  it('accepts http and https image URLs', () => {
    expect(normalizeTeamSymbolUrl(' https://cdn.example.com/team.png ')).toBe(
      'https://cdn.example.com/team.png'
    );
    expect(normalizeTeamSymbolUrl('http://example.com/logo.webp')).toBe(
      'http://example.com/logo.webp'
    );
  });

  it('accepts small png jpeg and webp data URLs', () => {
    expect(normalizeTeamSymbolUrl('data:image/png;base64,abc123')).toBe(
      'data:image/png;base64,abc123'
    );
    expect(normalizeTeamSymbolUrl('data:image/jpeg;base64,abc123')).toBe(
      'data:image/jpeg;base64,abc123'
    );
    expect(normalizeTeamSymbolUrl('data:image/webp;base64,abc123')).toBe(
      'data:image/webp;base64,abc123'
    );
  });

  it('turns blank and null values into null so the symbol can be cleared', () => {
    expect(normalizeTeamSymbolUrl('')).toBeNull();
    expect(normalizeTeamSymbolUrl('   ')).toBeNull();
    expect(normalizeTeamSymbolUrl(null)).toBeNull();
    expect(normalizeTeamSymbolUrl(undefined)).toBeNull();
  });

  it('rejects unsafe or unsupported values', () => {
    expect(() => normalizeTeamSymbolUrl('javascript:alert(1)')).toThrow(
      INVALID_TEAM_SYMBOL_MESSAGE
    );
    expect(() => normalizeTeamSymbolUrl('ftp://example.com/logo.png')).toThrow(
      INVALID_TEAM_SYMBOL_MESSAGE
    );
    expect(() => normalizeTeamSymbolUrl('data:image/svg+xml;base64,abc123')).toThrow(
      INVALID_TEAM_SYMBOL_MESSAGE
    );
    expect(() => normalizeTeamSymbolUrl({ src: 'https://cdn.example.com/team.png' })).toThrow(
      INVALID_TEAM_SYMBOL_MESSAGE
    );
  });

  it('rejects oversized data URLs', () => {
    const oversized = `data:image/png;base64,${'a'.repeat(MAX_TEAM_SYMBOL_DATA_URL_LENGTH)}`;

    expect(() => normalizeTeamSymbolUrl(oversized)).toThrow('Uploaded team symbol is too large');
  });

  it('normalizes team symbol focus positions to percentages', () => {
    expect(normalizeTeamSymbolPosition(25)).toBe(25);
    expect(normalizeTeamSymbolPosition('75')).toBe(75);
    expect(normalizeTeamSymbolPosition(25.6)).toBe(26);
    expect(normalizeTeamSymbolPosition(-20)).toBe(0);
    expect(normalizeTeamSymbolPosition(140)).toBe(100);
  });

  it('falls back to centered focus for missing or invalid positions', () => {
    expect(normalizeTeamSymbolPosition(undefined)).toBe(DEFAULT_TEAM_SYMBOL_POSITION);
    expect(normalizeTeamSymbolPosition(null)).toBe(DEFAULT_TEAM_SYMBOL_POSITION);
    expect(normalizeTeamSymbolPosition('not-a-number')).toBe(DEFAULT_TEAM_SYMBOL_POSITION);
    expect(normalizeTeamSymbolPosition(undefined, 35)).toBe(35);
  });
});
