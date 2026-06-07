import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firestore rules architecture', () => {
  it('keeps root league document mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const leagueRootBlock = source.match(
      /match \/leagues\/\{leagueId\} \{\n\s+allow read: if isLeagueMember\(leagueId\);\n\s+allow write: if [^;]+;/
    )?.[0];

    expect(leagueRootBlock).toBeDefined();
    expect(leagueRootBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(leagueRootBlock).toContain('allow write: if false;');
    expect(leagueRootBlock).not.toContain('allow write: if isLeagueManager(leagueId);');
  });

  it('keeps roster player ownership fields server-owned', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const rosterBlock = source.match(/match \/rosters\/\{teamId\} \{[\s\S]*?\n\s{6}\}/)?.[0];
    const lineupUpdateFunction = source.match(
      /function isRosterLineupUpdate\(leagueId\) \{[\s\S]*?\n\s{4}\}/
    )?.[0];

    expect(rosterBlock).toBeDefined();
    expect(rosterBlock).toContain('allow create: if false;');
    expect(rosterBlock).toContain('allow update: if isLeagueMember(leagueId)');
    expect(rosterBlock).toContain('isRosterLineupUpdate(leagueId)');
    expect(rosterBlock).toContain('allow delete: if false;');

    expect(lineupUpdateFunction).toBeDefined();
    expect(lineupUpdateFunction).not.toContain("'playerIds'");
    expect(lineupUpdateFunction).not.toContain("'leagueId'");
    expect(lineupUpdateFunction).not.toContain("'userId'");
    expect(lineupUpdateFunction).not.toContain("'memberId'");
  });

  it('keeps member administration behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const memberBlock = source.match(/match \/members\/\{userId\} \{[\s\S]*?\n\s{6}\}/)?.[0];
    const selfPreferenceFunction = source.match(
      /function isSelfMemberPreferenceUpdate\(userId\) \{[\s\S]*?\n\s{4}\}/
    )?.[0];

    expect(memberBlock).toBeDefined();
    expect(memberBlock).toContain('allow create: if false;');
    expect(memberBlock).toContain('allow update: if isSelfMemberPreferenceUpdate(userId);');
    expect(memberBlock).not.toContain('isLeagueManager(leagueId) ||');
    expect(memberBlock).toContain('allow delete: if false;');

    expect(selfPreferenceFunction).toBeDefined();
    expect(selfPreferenceFunction).not.toContain("'teamName'");
    expect(selfPreferenceFunction).not.toContain("'role'");
    expect(selfPreferenceFunction).not.toContain("'status'");
    expect(selfPreferenceFunction).not.toContain("'isActive'");
    expect(selfPreferenceFunction).not.toContain("'leagueId'");
  });

  it('keeps waiver mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const waiverBlock = source.match(/match \/waivers\/\{claimId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(waiverBlock).toBeDefined();
    expect(waiverBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(waiverBlock).toContain('allow create: if false;');
    expect(waiverBlock).toContain('allow update: if false;');
    expect(waiverBlock).toContain('allow delete: if false;');
  });

  it('keeps trade mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const tradeBlock = source.match(/match \/trades\/\{tradeId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(tradeBlock).toBeDefined();
    expect(tradeBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(tradeBlock).toContain('allow create: if false;');
    expect(tradeBlock).toContain('allow update: if false;');
    expect(tradeBlock).toContain('allow delete: if false;');
  });

  it('keeps team action mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const teamActionBlock = source.match(
      /match \/teamActions\/\{actionId\} \{[\s\S]*?\n\s{6}\}/
    )?.[0];

    expect(teamActionBlock).toBeDefined();
    expect(teamActionBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(teamActionBlock).toContain('allow create: if false;');
    expect(teamActionBlock).toContain('allow update: if false;');
    expect(teamActionBlock).toContain('allow delete: if false;');
  });

  it('keeps retired league watchlists inaccessible to clients', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const watchlistBlock = source.match(/match \/watchlists\/\{userId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(watchlistBlock).toBeDefined();
    expect(watchlistBlock).toContain('allow read, write: if false;');
    expect(watchlistBlock).not.toContain('allow read, write: if isLeagueMember(leagueId)');
  });

  it('keeps league config mutations behind server routes', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const configBlock = source.match(/match \/config\/\{configDoc\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(configBlock).toBeDefined();
    expect(configBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(configBlock).toContain('allow write: if false;');
    expect(configBlock).not.toContain('allow write: if isLeagueManager(leagueId);');
  });

  it('keeps league messages read-only until a send path exists', () => {
    const source = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    const messageBlock = source.match(/match \/messages\/\{messageId\} \{[\s\S]*?\n\s{6}\}/)?.[0];

    expect(messageBlock).toBeDefined();
    expect(messageBlock).toContain('allow read: if isLeagueMember(leagueId);');
    expect(messageBlock).toContain('allow create: if false;');
    expect(messageBlock).toContain('allow update: if false;');
    expect(messageBlock).toContain('allow delete: if false;');
  });
});
