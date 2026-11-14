import { describe, expect, it } from 'vitest';

import { assignMemberColours, MEMBER_COLOURS, memberColourIndex } from './SocialAuthor';

const author = (userId: string) => ({ userId, displayName: userId, teamName: 'Team' });

describe('assignMemberColours', () => {
  it('gives every author a different colour while colours last', () => {
    const authors = Array.from({ length: MEMBER_COLOURS.length }, (_, index) =>
      author(`coach-${index}`)
    );
    const assigned = assignMemberColours(authors);

    expect(new Set(assigned.values()).size).toBe(MEMBER_COLOURS.length);
  });

  it('keeps the same colours for the same people, in any message order', () => {
    const people = [author('sam'), author('jo'), author('kim')];
    const first = assignMemberColours(people);
    const reordered = assignMemberColours([people[2], people[0], people[1], people[0]]);

    for (const person of people) {
      expect(memberColourIndex(person, reordered)).toBe(memberColourIndex(person, first));
    }
  });
});
