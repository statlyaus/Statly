# Dependency Update Report
Generated: 2026-01-03

## Summary
- **Total outdated packages**: ~40+
- **Safe to update (patch/minor)**: ~25 packages
- **Major updates requiring review**: ~10 packages

## Safe Updates (Patch/Minor) - Recommended to Update Now

### Dependencies
- `@clickhouse/client`: 1.12.1 → 1.15.0 (minor)
- `axios`: 1.12.1 → 1.13.2 (minor)
- `bullmq`: 5.58.5 → 5.66.4 (minor)
- `canvas-confetti`: 1.9.3 → 1.9.4 (patch)
- `chart.js`: 4.5.0 → 4.5.1 (patch)
- `dotenv`: 17.2.2 → 17.2.3 (patch)
- `express`: 5.1.0 → 5.2.1 (minor)
- `firebase-admin`: 13.5.0 → 13.6.0 (minor)
- `framer-motion`: 12.23.12 → 12.23.26 (patch)
- `ioredis`: 5.7.0 → 5.8.2 (minor)
- `react`: 19.1.1 → 19.2.3 (minor)
- `react-dom`: 19.1.1 → 19.2.3 (minor)
- `react-chartjs-2`: 5.3.0 → 5.3.1 (patch)
- `redis`: 5.8.2 → 5.10.0 (minor)

### DevDependencies
- `@eslint/js`: 9.35.0 → 9.39.2 (minor)
- `@tailwindcss/forms`: 0.5.10 → 0.5.11 (patch)
- `@tailwindcss/postcss`: 4.1.13 → 4.1.18 (patch)
- `@tailwindcss/typography`: 0.5.16 → 0.5.19 (patch)
- `@testing-library/jest-dom`: 6.8.0 → 6.9.1 (minor)
- `@testing-library/react`: 16.3.0 → 16.3.1 (patch)
- `@types/react-dom`: 19.1.9 → 19.2.3 (minor)
- `autoprefixer`: 10.4.21 → 10.4.23 (patch)
- `eslint`: 9.35.0 → 9.39.2 (minor)
- `prettier`: 3.6.2 → 3.7.4 (minor)
- `rimraf`: 6.0.1 → 6.1.2 (minor)

## Major Updates - Review Before Updating

### Critical Framework Updates
- **Next.js**: 15.5.3 → 16.1.1 (MAJOR)
  - ⚠️ Breaking changes likely
  - Review migration guide: https://nextjs.org/docs/app/building-your-application/upgrading/version-16
  - Test thoroughly before updating

- **Prisma**: 6.16.1 → 7.2.0 (MAJOR)
  - ⚠️ Breaking changes likely
  - Review migration guide: https://www.prisma.io/docs/guides/upgrade-guides
  - Update `@prisma/client` together

- **React**: Already on 19.x (latest minor: 19.2.3)
  - Safe to update to 19.2.3

### Other Major Updates
- **OpenAI SDK**: 5.20.2 → 6.15.0 (MAJOR)
  - ⚠️ Breaking changes likely
  - Review API changes

- **Firebase**: 12.2.1 → 12.7.0 (minor - safe)
  - Can update safely

- **Storybook**: 9.1.5 → 10.1.11 (MAJOR)
  - ⚠️ Breaking changes likely
  - Only update if actively using Storybook

- **@vitest/ui**: 3.2.4 → 4.0.16 (MAJOR)
  - ⚠️ Breaking changes likely
  - Update vitest core first

- **@eslint/compat**: 1.3.2 → 2.0.0 (MAJOR)
  - ⚠️ Breaking changes likely
  - Review ESLint config

- **eslint-plugin-react-hooks**: 5.2.0 → 7.0.1 (MAJOR)
  - ⚠️ Breaking changes likely
  - Review React 19 compatibility

- **globals**: 16.4.0 → 17.0.0 (MAJOR)
  - ⚠️ Breaking changes likely

- **jsdom**: 26.1.0 → 27.4.0 (MAJOR)
  - ⚠️ Breaking changes likely

- **globby**: 14.1.0 → 16.1.0 (MAJOR)
  - ⚠️ Breaking changes likely

## Recommended Update Strategy

### Phase 1: Safe Updates (Do Now)
Update all patch and minor versions that don't require breaking changes.

### Phase 2: Review Major Updates
1. Test Next.js 16 upgrade in a separate branch
2. Review Prisma 7 migration guide
3. Update React to 19.2.3 (safe minor update)
4. Update Firebase to 12.7.0 (safe minor update)

### Phase 3: Optional Major Updates
- OpenAI SDK (if needed)
- Storybook (if actively used)
- Testing libraries (vitest, jsdom)

## Notes
- `@types/cheerio`: Latest is 0.22.35, but you have 1.0.0 - this might be intentional
- `@headlessui/react`: 2.2.8 → 2.2.9 (patch available but not in wanted range)
- `daisyui`: 5.1.10 → 5.5.14 (major update available)
- `lucide-react`: 0.544.0 → 0.562.0 (minor update available)
- `react-window`: 2.1.0 → 2.2.3 (minor update available)
- `@tanstack/react-query`: 5.87.4 → 5.90.16 (minor update available)

