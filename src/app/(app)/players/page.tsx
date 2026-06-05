import { AppLayout } from '@/components/navigation';
import PlayersPageServer from './PlayersPageServer';
import type { JSX } from 'react';

export default function PlayersPage(): JSX.Element {
  return (
    <AppLayout>
      <PlayersPageServer />
    </AppLayout>
  );
}
