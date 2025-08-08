'use client';

import { useAuth } from '@/AuthContext';
import AuthCTA from '@/components/AuthCTA';
import DashboardLoading from '@/components/DashboardLoading';
import UserDashboard from '@/components/UserDashboard';

export default function DashboardPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <DashboardLoading />;
  }

  if (!user) {
    return <AuthCTA />;
  }

            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="Go to My Team"
          >
            Go to My Team &rarr;
          </Link>
        </article>

        {/* Player Stats */}
        <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
          <h2 className="text-xl font-bold mb-2">Player Stats</h2>
          <p className="text-muted-foreground mb-4">
            Browse stats for all available players in the league.
          </p>
          <Link
            href="/stats"
            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="View All Stats"
          >
            View All Stats &rarr;
          </Link>
        </article>

        {/* Draft Room */}
        <article className="p-6 bg-card text-card-foreground shadow-md rounded-xl border border-border">
          <h2 className="text-xl font-bold mb-2">Draft Room</h2>
          <p className="text-muted-foreground mb-4">
            The draft is in progress! Go to the draft room to make your pick.
          </p>
          <Link
            href="/draft"
            className="inline-flex items-center font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5"
            aria-label="Enter Draft Room"
          >
            Enter Draft &rarr;
          </Link>
        </article>
      </section>
    </main>
  );
}
