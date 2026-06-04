'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Brain,
  Clock,
  GitMerge,
  Layers,
  Loader2,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/hooks/useSearch';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import type { SearchMode, SearchResultItem } from '@/types';

const PAGE_SIZE = 20;

// ── Mode definitions ──────────────────────────────────────────────────────────

interface ModeDef {
  id: SearchMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const MODES: ModeDef[] = [
  {
    id: 'keyword',
    label: 'Keyword',
    icon: <Search className="w-3.5 h-3.5" />,
    description: 'Exact word matching with highlighted snippets',
  },
  {
    id: 'semantic',
    label: 'Semantic',
    icon: <Brain className="w-3.5 h-3.5" />,
    description: 'Meaning-based — finds notes even without exact keywords',
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    icon: <GitMerge className="w-3.5 h-3.5" />,
    description: 'Combines keyword + semantic for best overall results',
  },
];

// ── main view ─────────────────────────────────────────────────────────────────

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const initialQ = searchParams.get('q') ?? '';
  const initialWs = searchParams.get('workspace_id') ?? '';
  const initialMode = (searchParams.get('mode') as SearchMode) ?? 'keyword';
  const initialPage = Number(searchParams.get('page') ?? '1');

  const [query, setQuery] = useState(initialQ);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [workspaceId, setWorkspaceId] = useState(initialWs);
  const [page, setPage] = useState(initialPage);
  const [showFilters, setShowFilters] = useState(!!initialWs);

  const debouncedQuery = useDebounce(query, 350);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  // Sync URL — no history noise on every keystroke
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedQuery.trim()) p.set('q', debouncedQuery.trim());
    if (mode !== 'keyword') p.set('mode', mode);
    if (workspaceId) p.set('workspace_id', workspaceId);
    if (page > 1) p.set('page', String(page));
    router.replace(`/search?${p}`, { scroll: false });
  }, [debouncedQuery, mode, workspaceId, page, router]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedQuery, mode, workspaceId]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data, isLoading, isFetching } = useSearch({
    query: debouncedQuery,
    mode,
    page,
    workspaceId: workspaceId || undefined,
    pageSize: PAGE_SIZE,
  });

  const hasQuery = debouncedQuery.trim().length >= 2;
  const results = data?.items ?? [];
  const semanticAvailable = data?.semantic_available ?? true;

  const handleModeChange = useCallback((m: SearchMode) => {
    setMode(m);
    setPage(1);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Header ── */}
      <div className="px-6 py-4 border-b bg-background shrink-0 space-y-3">
        {/* Search input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === 'semantic'
                  ? 'Describe what you\'re looking for…'
                  : mode === 'hybrid'
                    ? 'Keywords or natural language…'
                    : 'Search notes…'
              }
              className="pl-9 pr-8 h-9 text-sm"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="h-9 gap-1.5 shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter
          </Button>
        </div>

        {/* Mode switcher */}
        <div className="flex items-center gap-1">
          {MODES.map((m) => {
            const unavailable = m.id !== 'keyword' && !semanticAvailable;
            return (
              <button
                key={m.id}
                onClick={() => !unavailable && handleModeChange(m.id)}
                disabled={unavailable}
                title={unavailable ? 'Requires OPENAI_API_KEY' : m.description}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  mode === m.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : unavailable
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {m.icon}
                {m.label}
                {m.id === 'hybrid' && !unavailable && (
                  <span className="text-[9px] font-bold bg-amber-400/20 text-amber-600 dark:text-amber-400 px-1 rounded">
                    BEST
                  </span>
                )}
                {unavailable && (
                  <span className="text-[9px] text-muted-foreground/40">no key</span>
                )}
              </button>
            );
          })}

          {/* Mode description */}
          <span className="ml-2 text-[11px] text-muted-foreground/60 hidden sm:block">
            {MODES.find((m) => m.id === mode)?.description}
          </span>
        </div>

        {/* Workspace filter */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Workspace:</span>
            <button onClick={() => setWorkspaceId('')} className={chipCls(!workspaceId)}>
              All
            </button>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setWorkspaceId(ws.id === workspaceId ? '' : ws.id)}
                className={chipCls(ws.id === workspaceId)}
              >
                {ws.icon} {ws.name}
              </button>
            ))}
          </div>
        )}

        {/* Status line */}
        {hasQuery && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground h-4">
            {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
            {!isFetching && data && (
              <>
                <span>
                  {data.total === 0
                    ? 'No results'
                    : `${data.total} result${data.total !== 1 ? 's' : ''}`}
                  {workspaceId && workspaces.find((w) => w.id === workspaceId)
                    ? ` in ${workspaces.find((w) => w.id === workspaceId)!.name}`
                    : ''}
                </span>
                {mode === 'semantic' && (
                  <span className="flex items-center gap-1 text-violet-500">
                    <Sparkles className="w-2.5 h-2.5" />
                    Semantic
                  </span>
                )}
                {mode === 'hybrid' && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <Layers className="w-2.5 h-2.5" />
                    Hybrid
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto">
        {!hasQuery && <EmptyPrompt mode={mode} />}

        {hasQuery && isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            {mode === 'semantic' ? 'Searching semantically…' : mode === 'hybrid' ? 'Running hybrid search…' : 'Searching…'}
          </div>
        )}

        {hasQuery && !isLoading && results.length === 0 && (
          <NoResults query={debouncedQuery} mode={mode} />
        )}

        {results.length > 0 && (
          <div className="max-w-3xl px-6 py-4 space-y-2">
            {results.map((item) => (
              <ResultCard key={item.note_id} item={item} activeMode={mode} />
            ))}
            {data && data.pages > 1 && (
              <Pagination page={page} pages={data.pages} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ResultCard ────────────────────────────────────────────────────────────────

function ResultCard({ item, activeMode }: { item: SearchResultItem; activeMode: SearchMode }) {
  const isSemantic = item.match_type === 'semantic';
  const isHybrid = item.match_type === 'hybrid';

  return (
    <Link
      href={`/workspaces/${item.workspace_id}/notes/${item.note_id}`}
      className="block rounded-lg border bg-background hover:bg-accent hover:border-accent-foreground/10 transition-colors p-4 group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
            {item.workspace_name}
          </span>
          {/* Match-type badge */}
          {isHybrid && (
            <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
              HYBRID
            </span>
          )}
          {isSemantic && (
            <span className="text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-950/40 px-1.5 py-0.5 rounded">
              SEMANTIC
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Similarity bar (semantic / hybrid) */}
          {item.similarity !== null && (
            <SimilarityBadge value={item.similarity} />
          )}
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatDate(item.updated_at)}
          </span>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold mb-1.5 leading-snug">
        {isSemantic ? (
          <span>{item.title}</span>
        ) : (
          <Highlight html={item.title_headline || item.title} />
        )}
      </h3>

      {/* Snippet */}
      {item.content_headline && item.content_headline.trim() && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {isSemantic ? (
            <span>{item.content_headline}</span>
          ) : (
            <Highlight html={item.content_headline} />
          )}
        </p>
      )}
    </Link>
  );
}

// ── SimilarityBadge ───────────────────────────────────────────────────────────

function SimilarityBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
    pct >= 60 ? 'text-blue-600 dark:text-blue-400' :
    'text-muted-foreground';

  return (
    <span className={cn('text-[10px] font-medium tabular-nums flex items-center gap-0.5', color)}>
      <Sparkles className="w-2.5 h-2.5" />
      {pct}%
    </span>
  );
}

// ── Highlight ─────────────────────────────────────────────────────────────────

function Highlight({ html }: { html: string }) {
  // Strip all HTML except <mark> — content_text is plain text so no injection risk,
  // but be defensive anyway.
  const safe = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '\x00lt\x00')
    .replace(/>/g, '\x00gt\x00')
    .replace(/\x00lt\x00mark\x00gt\x00/g, '<mark>')
    .replace(/\x00lt\x00\/mark\x00gt\x00/g, '</mark>')
    .replace(/\x00lt\x00[^/][^\x00]*\x00gt\x00/g, '')
    .replace(/\x00lt\x00\/[^\x00]*\x00gt\x00/g, '')
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

function EmptyPrompt({ mode }: { mode: SearchMode }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
      {mode === 'semantic' ? (
        <Brain className="w-8 h-8 opacity-20" />
      ) : mode === 'hybrid' ? (
        <GitMerge className="w-8 h-8 opacity-20" />
      ) : (
        <Search className="w-8 h-8 opacity-20" />
      )}
      <div className="text-center space-y-1">
        {mode === 'semantic' && (
          <>
            <p className="text-sm font-medium">Semantic search</p>
            <p className="text-xs opacity-70">
              Describe a concept, idea, or topic — finds notes by meaning, not keywords
            </p>
          </>
        )}
        {mode === 'hybrid' && (
          <>
            <p className="text-sm font-medium">Hybrid search</p>
            <p className="text-xs opacity-70">
              Combines exact keyword matching with semantic understanding
            </p>
          </>
        )}
        {mode === 'keyword' && (
          <>
            <p className="text-sm font-medium">Search your notes</p>
            <p className="text-xs opacity-70">Find anything across titles and content</p>
          </>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground/50 space-y-0.5 text-center mt-2">
        <p><kbd className="px-1.5 py-0.5 rounded border text-[10px] bg-muted">⌘K</kbd> to jump here</p>
        {mode === 'keyword' && (
          <>
            <p>Exact phrases: <code className="bg-muted px-1 rounded">"project plan"</code></p>
            <p>Exclude: <code className="bg-muted px-1 rounded">-draft</code></p>
          </>
        )}
        {mode === 'semantic' && (
          <p>Try: <em>"notes about team performance"</em></p>
        )}
      </div>
    </div>
  );
}

function NoResults({ query, mode }: { query: string; mode: SearchMode }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
      <SearchX className="w-8 h-8 opacity-20" />
      <div className="text-center">
        <p className="text-sm">No notes found for <strong>"{query}"</strong></p>
        <p className="text-xs mt-1 opacity-70">
          {mode === 'semantic'
            ? 'Try different phrasing — semantic search works best with descriptive sentences'
            : mode === 'hybrid'
              ? 'No keyword or semantic matches found'
              : 'Try different keywords or switch to Semantic mode'}
        </p>
      </div>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, pages, total, pageSize, onChange }: {
  page: number; pages: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t">
      <p className="text-xs text-muted-foreground">{from}–{to} of {total}</p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</Button>
        {pageRange(page, pages).map((n, i) =>
          n === null ? (
            <span key={`e${i}`} className="px-1 text-muted-foreground text-xs">…</span>
          ) : (
            <Button key={n} variant={n === page ? 'default' : 'ghost'} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => onChange(n)}>{n}</Button>
          )
        )}
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function chipCls(active: boolean) {
  return `px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`;
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
