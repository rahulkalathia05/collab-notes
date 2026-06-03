'use client';

import { useEffect, useState } from 'react';
import { Search, FolderOpen } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { WorkspaceCard } from '@/components/workspace/WorkspaceCard';
import { CreateWorkspaceDialog } from '@/components/workspace/CreateWorkspaceDialog';
import { workspaceService } from '@/services/workspaceService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDebounce } from '@/hooks/useDebounce';
import type { PaginatedResponse, Workspace, WorkspaceFilters } from '@/types';

const ROLE_FILTERS: { label: string; value: WorkspaceFilters['role'] }[] = [
  { label: 'All', value: '' },
  { label: 'Owner', value: 'owner' },
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Viewer', value: 'viewer' },
];

const PAGE_SIZE = 12;

export default function WorkspacesPage() {
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<WorkspaceFilters['role']>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<Workspace> | null>(null);
  const [loading, setLoading] = useState(true);

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, role]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    workspaceService
      .list({
        search: debouncedSearch || undefined,
        role: role || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        // Keep sidebar in sync with first page when no filters active
        if (!debouncedSearch && !role && page === 1) {
          setWorkspaces(res.items);
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, role, page, setWorkspaces]);

  const isFiltering = !!debouncedSearch || !!role;
  const workspaces = data?.items ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <>
      <Header
        title="Workspaces"
        description={data ? `${data.total} workspace${data.total !== 1 ? 's' : ''}` : undefined}
        actions={<CreateWorkspaceDialog />}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Toolbar */}
        <div className="px-6 pt-5 pb-4 flex flex-wrap items-center gap-3 border-b">
          {/* Search */}
          <div className="relative flex-1 min-w-48 max-w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces…"
              className="pl-8 h-8 text-sm"
            />
          </div>

          {/* Role filter */}
          <div className="flex items-center gap-1">
            {ROLE_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={role === f.value ? 'default' : 'ghost'}
                className="h-8 px-2.5 text-xs"
                onClick={() => setRole(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="p-6">
          {loading ? (
            <WorkspaceSkeleton />
          ) : workspaces.length === 0 ? (
            <EmptyState isFiltering={isFiltering} onClear={() => { setSearch(''); setRole(''); }} />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {workspaces.map((ws) => (
                  <WorkspaceCard key={ws.id} workspace={ws} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <Pagination
                  page={page}
                  pages={totalPages}
                  total={data?.total ?? 0}
                  pageSize={PAGE_SIZE}
                  onChange={setPage}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function WorkspaceSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-32 rounded-xl bg-muted animate-pulse"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}

function EmptyState({
  isFiltering,
  onClear,
}: {
  isFiltering: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
      <FolderOpen className="w-10 h-10 opacity-20" />
      {isFiltering ? (
        <>
          <p className="text-sm">No workspaces match your filters.</p>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">No workspaces yet.</p>
          <CreateWorkspaceDialog />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </Button>

        {/* Page numbers — show at most 5 pages around current */}
        {pageNumbers(page, pages).map((n, i) =>
          n === null ? (
            <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-xs">…</span>
          ) : (
            <Button
              key={n}
              variant={n === page ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0 text-xs"
              onClick={() => onChange(n)}
            >
              {n}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={page === pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function pageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | null)[] = [1];
  if (current > 3) pages.push(null);

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push(null);
  pages.push(total);

  return pages;
}
