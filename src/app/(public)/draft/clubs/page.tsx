import { DraftHubState } from '@/components/draft/DraftHubState';
import { DraftClubsDirectory } from '@/components/draft/DraftClubsDirectory';
import { listDraftClubs } from '@/lib/draftTrades/read';

export const dynamic = 'force-dynamic';

export default async function DraftClubsPage() {
  try {
    const clubs = await listDraftClubs();

    if (clubs.length === 0) {
      return (
        <DraftHubState
          variant="empty"
          title="No club trade records found"
          description="The club directory is ready, but no club-level trade records have been imported yet."
        />
      );
    }

    return <DraftClubsDirectory clubs={clubs} />;
  } catch {
    return (
      <DraftHubState
        variant="error"
        title="Club trade records could not be loaded"
        description="The public club directory is temporarily unavailable. Retry the directory to load the latest imported records."
        actionHref="/draft/clubs"
        actionLabel="Retry clubs"
      />
    );
  }
}
