import { Suspense } from 'react';
import { SearchView } from '@/components/search/SearchView';

export const metadata = { title: 'Search — CollabNotes' };

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
