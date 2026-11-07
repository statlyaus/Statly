import type { Metadata } from 'next';

import { BasketballLeagueForm } from '@/components/basketball/setup/BasketballLeagueForm';
import { BasketballPageHeading } from '@/components/basketball/shell/BasketballPageHeading';

export const metadata: Metadata = { title: 'Set up a basketball league | Statly' };

export default function NewBasketballLeaguePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
      <BasketballPageHeading
        title="Set up a basketball league"
        description="Tell Statly how your league scores. The defaults are Yahoo's for the 2026-27 season, and you can change any of this later in Settings."
      />
      <BasketballLeagueForm mode="create" />
    </div>
  );
}
