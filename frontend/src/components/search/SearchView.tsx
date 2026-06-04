'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Clock,
  FileText,
  Loader2,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/hooks/useSearch';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDebounce } from '@/hooks/useDebounce';
import type { SearchResultItem } from '@/types';

const PAGE_SIZE = 20;

// ── main view ─────────────────────────────────────────────────────────────────

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const initialQ = searchParams.get('q') ?? '';
  const initialWs = searchParams.get('workspace_id') ?? '';
  const initialPage = Number(searchParams.get('page') ?? '1');

  const [query, setQuery] = useState(initialQ);
  const [workspaceId, setWorkspaceId] = useState(initialWs);
  const [page, setPage] = useState(initialPage);
  const [showFilters, setShowFilters] = useState(!!initialWs);

  const debouncedQuery = useDebounce(query, 350);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  // Sync URL when search params change
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedQuery.trim()) p.set('q', debouncedQuery.trim());
    if (workspaceId) p.set('workspace_id', workspaceId);
    if (page > 1) p.set('page', String(page));
    router.replace(`/search?${p}`, { scroll: false });
  }, [debouncedQuery, workspaceId, page, router]);

  // Reset to page 1 when query or workspace changes
  useEffect(() => { setPage(1); }, [debouncedQuery, workspaceId]);

  // Auto-focus
  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data, isLoading, isFetching } = useSearch({
    query: debouncedQuery,
    page,
    workspaceId: workspaceId || undefined,
    pageSize: PAGE_SIZE,
  });

  const hasQuery = debouncedQuery.trim().length >= 2;
  const results = data?.items ?? [];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Search header ── */}
      <div className="px-6 py-4 border-b bg-background shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="pl-9 pr-8 h-9 text-sm"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Button
            variant={showFilters ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="h-9 gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter
          </Button>
        </div>

        {/* ── Workspace filter ── */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Workspace:</span>
            <button
              onClick={() => setWorkspaceId('')}
              className={filterBtnCls(!workspaceId)}
            >
              All
            </button>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setWorkspaceId(ws.id === workspaceId ? '' : ws.id)}
                className={filterBtnCls(ws.id === workspaceId)}
              >
                {ws.icon} {ws.name}
              </button>
            ))}
          </div>
        )}

        {/* ── Status line ── */}
        {hasQuery && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground h-4">
            {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
            {!isFetching && data && (
              <span>
                {data.total === 0
                  ? 'No results'
                  : `${data.total} result${data.total !== 1 ? 's' : ''}`}
                {workspaceId && workspaces.find((w) => w.id === workspaceId)
                  ? ` in ${workspaces.find((w) => w.id === workspaceId)!.name}`
                  : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Initial empty — no query */}
        {!hasQuery && (
          <EmptyPrompt />
        )}

        {/* Loading */}
        {hasQuery && isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching…
          </div>
        )}

        {/* No results */}
        {hasQuery && !isLoading && results.length === 0 && (
          <NoResults query={debouncedQuery} />
        )}

        {/* Results list */}
        {results.length > 0 && (
          <div className="max-w-3xl px-6 py-4 space-y-1">
            {results.map((item) => (
              <ResultCard key={item.note_id} item={item} />
            ))}

            {data && data.pages > 1 && (
              <Pagination
                page={page}
                pages={data.pages}
                total={data.total}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ResultCard ─────────────────────────────────────────────────────────────────

function ResultCard({ item }: { item: SearchResultItem }) {
  return (
    <Link
      href={`/workspaces/${item.workspace_id}/notes/${item.note_id}`}
      className="block rounded-lg border bg-background hover:bg-accent hover:border-accent-foreground/10 transition-colors p-4 group"
    >
      {/* Workspace badge */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {item.workspace_name}
        </span>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Clock className="w-2.5 h-2.5" />
          {formatDate(item.updated_at)}
        </span>
      </div>

      {/* Title with highlights */}
      <h3 className="text-sm font-semibold mb-1.5 leading-snug">
        <Highlight html={item.title_headline || item.title} />
      </h3>

      {/* Content snippet */}
      {item.content_headline && item.content_headline.trim() && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          <Highlight html={item.content_headline} />
        </p>
      )}
    </Link>
  );
}

// ── Highlight ─────────────────────────────────────────────────────────────────

/**
 * Renders PostgreSQL ts_headline output safely.
 * Only <mark> tags are preserved — all other tags are stripped.
 */
function Highlight({ html }: { html: string }) {
  // Strip everything except <mark> and </mark>
  const safe = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '\x00lt\x00')
    .replace(/>/g, '\x00gt\x00')
    .replace(/\x00lt\x00mark\x00gt\x00/g, '<mark>')
    .replace(/\x00lt\x00\/mark\x00gt\x00/g, '</mark>')
    .replace(/\x00lt\x00[^/][^>]*\x00gt\x00/g, '')
    .replace(/\x00lt\x00\/[^>]*\x00gt\x00/g, '')
    .replace(/\x00lt\x00/g, '&lt;')
    .replace(/\x00gt\x00/g, '&gt;');

  return (
    <span
      dangerouslySetInnerHTML={{ __html: safe }}
      className="[&_mark]:bg-amber-200 [&_mark]:dark:bg-amber-800/60 [&_mark]:text-inherit [&_mark]:rounded-sm [&_mark]:px-px"
    />
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
      <Search className="w-8 h-8 opacity-20" />
      <div className="text-center">
        <p className="text-sm font-medium">Search your notes</p>
        <p className="text-xs mt-1 opacity-70">
          Find anything across titles and content
        </p>
      </div>
      <div className="text-[11px] text-muted-foreground/50 space-y-0.5 text-center mt-2">
        <p><kbd className="px-1.5 py-0.5 rounded border text-[10px] bg-muted">⌘K</kbd> to jump here from anywhere</p>
        <p>Use quotes for exact phrases: <code className="bg-muted px-1 rounded">"project plan"</code></p>
        <p>Exclude terms with <code className="bg-muted px-1 rounded">-word</code></p>
      </div>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
      <SearchX className="w-8 h-8 opacity-20" />
      <div className="text-center">
        <p className="text-sm">No notes found for <strong>"{query}"</strong></p>
        <p className="text-xs mt-1 opacity-70">Try different keywords or check spelling</p>
      </div>
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────

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
        {pageRange(page, pages).map((n, i) =>
          n === null ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground text-xs">…</span>
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

// ── helpers ───────────────────────────────────────────────────────────────────

function filterBtnCls(active: boolean) {
  return `px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
    active
      ? 'bg-primary text-primary-foreground'
      : 'bg-muted text-muted-foreground hover:bg-muted/80'
  }`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pageRange(current: number, total: number): (number | null)[] {
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
