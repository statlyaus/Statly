export type DesignDriftCategory = 'palette' | 'legacy-icon';

export type DesignDriftAllowlistEntry = {
  filePattern: RegExp;
  category?: DesignDriftCategory;
  valuePattern?: RegExp;
  reason: string;
};

export const designDriftAllowlist: DesignDriftAllowlistEntry[] = [
  {
    filePattern: /^src\/app\/page\.tsx$/,
    category: 'palette',
    reason:
      'Public homepage uses intentional brand/art direction pending a separate marketing-page design review.',
  },
  {
    filePattern: /^src\/app\/fantasy\/page\.tsx$/,
    category: 'palette',
    reason:
      'Public fantasy landing page uses intentional campaign art direction pending a separate marketing-page design review.',
  },
  {
    filePattern: /^src\/components\/demos\/AuthFormDemo\.tsx$/,
    reason:
      'Unreferenced auth form demo preserves historical visual states until demo inventory cleanup.',
  },
  {
    filePattern: /^src\/components\/demos\/AuthHeaderDemo\.tsx$/,
    reason:
      'Unreferenced auth header demo preserves historical visual states until demo inventory cleanup.',
  },
  {
    filePattern: /^src\/components\/demos\/AvailablePlayersDemo\.tsx$/,
    reason:
      'Unreferenced available players demo preserves historical table examples until demo inventory cleanup.',
  },
  {
    filePattern: /^src\/components\/demos\/MatchLogTableDemo\.tsx$/,
    reason:
      'Unreferenced match log demo preserves historical table examples until demo inventory cleanup.',
  },
  {
    filePattern: /^src\/components\/demos\/MyTeamPanelDemo\.tsx$/,
    reason:
      'Unreferenced team panel demo preserves historical roster layout examples until demo inventory cleanup.',
  },
  {
    filePattern: /^src\/components\/demos\/MyTeamPanelDemo2\.tsx$/,
    reason:
      'Unreferenced alternate team panel demo preserves historical roster layout examples until demo inventory cleanup.',
  },
];
