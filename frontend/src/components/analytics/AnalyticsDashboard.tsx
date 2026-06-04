'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  FileText,
  Loader2,
  MessageSquare,
  Minus,
  PenLine,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAnalytics } from '@/hooks/useAnalytics';
import { LineChart, BarChart, Sparkline } from './Charts';
import { cn } from '@/lib/utils';
import type { AnalyticsData, DateCount, MemberActivity, TopNote } from '@/services/analyticsService';

const PERIODS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
] as const;

// ── Main dashboard ────────────────────────────────────────────────────────────

export function AnalyticsDashboard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const { data, isLoading, error } = useAnalytics(workspaceId, period);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background shrink-0">
        <div>
          <h1 className="text-sm font-semibold">{workspaceName}</h1>
          <p className="text-xs text-muted-foreground">Analytics dashboard</p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value as 7 | 30 | 90)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                period === p.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading analytics…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-64 text-destructive text-sm">
          Failed to load analytics. Try again.
        </div>
      )}

      {data && <DashboardBody data={data} workspaceId={workspaceId} />}
    </div>
  );
}

// ── Dashboard body ────────────────────────────────────────────────────────────

function DashboardBody({ data, workspaceId }: { data: AnalyticsData; workspaceId: string }) {
  const { overview } = data;

  const aiBarData = aggregateAIByAction(data.ai_usage_over_time);

  // Merge notes + edits for combined chart
  const combinedData = data.notes_over_time.map((n, i) => ({
    date: n.date,
    notes: n.count,
    edits: data.edits_over_time[i]?.count ?? 0,
  }));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* ── Overview cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          icon={<FileText className="w-4 h-4" />}
          label="Notes"
          value={overview.total_notes}
          delta={overview.notes_delta}
          sparkData={data.notes_over_time}
          color="#6366f1"
          colorClass="text-indigo-500"
        />
        <MetricCard
          icon={<Users className="w-4 h-4" />}
          label="Members"
          value={overview.total_users}
          color="#10b981"
          colorClass="text-emerald-500"
        />
        <MetricCard
          icon={<PenLine className="w-4 h-4" />}
          label="Edits"
          value={overview.total_edits}
          delta={overview.edits_delta}
          sparkData={data.edits_over_time}
          color="#f59e0b"
          colorClass="text-amber-500"
        />
        <MetricCard
          icon={<Brain className="w-4 h-4" />}
          label="AI Calls"
          value={overview.total_ai_calls}
          delta={overview.ai_delta}
          sparkData={data.ai_usage_over_time}
          color="#8b5cf6"
          colorClass="text-violet-500"
        />
        <MetricCard
          icon={<MessageSquare className="w-4 h-4" />}
          label="Comments"
          value={overview.total_comments}
          delta={overview.comments_delta}
          sparkData={data.collaboration_over_time}
          color="#06b6d4"
          colorClass="text-cyan-500"
        />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Notes & Edits" className="lg:col-span-2">
          {/* Dual-series line chart — notes in indigo, edits in amber */}
          <div className="relative">
            <LineChart
              data={data.notes_over_time}
              color="#6366f1"
              height={168}
              showXLabels={false}
            />
            <div className="absolute inset-0 pointer-events-none">
              <LineChart
                data={data.edits_over_time}
                color="#f59e0b"
                height={168}
                showXLabels
              />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Notes created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-amber-500 inline-block" /> Edits (versions)
            </span>
          </div>
        </ChartCard>

        <ChartCard title="Active Users">
          <LineChart data={data.active_users_over_time} color="#10b981" height={168} />
          <p className="text-xs text-muted-foreground mt-2">
            Unique members who created notes, saved versions, or posted comments
          </p>
        </ChartCard>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="AI Usage by Feature">
          {aiBarData.length > 0 ? (
            <>
              <BarChart data={aiBarData} color="#8b5cf6" height={160} />
              <p className="text-xs text-muted-foreground mt-2">
                Total AI calls across all features in the period
              </p>
            </>
          ) : (
            <EmptyChart message="No AI calls in this period" />
          )}
        </ChartCard>

        <ChartCard title="Collaboration Activity">
          <LineChart data={data.collaboration_over_time} color="#06b6d4" height={160} />
          <p className="text-xs text-muted-foreground mt-2">Comments posted per day</p>
        </ChartCard>
      </div>

      {/* ── Tables row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Most Active Notes">
          {data.top_notes.length > 0 ? (
            <TopNotesTable notes={data.top_notes} workspaceId={workspaceId} />
          ) : (
            <EmptyChart message="No note activity in this period" />
          )}
        </ChartCard>

        <ChartCard title="Member Activity">
          <MemberActivityTable members={data.member_activity} />
        </ChartCard>
      </div>

      <p className="text-center text-xs text-muted-foreground/50 pb-4">
        Data cached for 5 minutes · Generated {new Date(data.generated_at).toLocaleTimeString()}
      </p>
    </div>
  );
}

// ── MetricCard ────────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  delta,
  sparkData,
  color,
  colorClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  delta?: number;
  sparkData?: { date: string; count: number }[];
  color: string;
  colorClass: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className={cn('text-muted-foreground', colorClass)}>{icon}</span>
        {sparkData && <Sparkline data={sparkData} color={color} />}
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      {delta !== undefined && (
        <DeltaBadge delta={delta} />
      )}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Minus className="w-2.5 h-2.5" /> Same as prev period</span>;
  }
  const pos = delta > 0;
  return (
    <span className={cn('text-[10px] flex items-center gap-0.5 font-medium', pos ? 'text-emerald-600' : 'text-red-500')}>
      {pos ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
      {pos ? '+' : ''}{delta} vs prev period
    </span>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-background p-4', className)}>
      <p className="text-sm font-semibold mb-3">{title}</p>
      {children}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground/40 text-xs">
      {message}
    </div>
  );
}

// ── TopNotesTable ─────────────────────────────────────────────────────────────

function TopNotesTable({ notes, workspaceId }: { notes: TopNote[]; workspaceId: string }) {
  return (
    <div className="divide-y text-xs">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-2 text-muted-foreground font-medium uppercase tracking-wide text-[10px]">
        <span>Note</span>
        <span className="text-right">Edits</span>
        <span className="text-right">Comments</span>
      </div>
      {notes.map((n) => (
        <div key={n.note_id} className="grid grid-cols-[1fr_auto_auto] gap-3 py-2 items-center">
          <Link
            href={`/workspaces/${workspaceId}/notes/${n.note_id}`}
            className="truncate font-medium hover:text-primary transition-colors"
          >
            {n.title || 'Untitled'}
          </Link>
          <span className="text-right tabular-nums text-muted-foreground">{n.edits}</span>
          <span className="text-right tabular-nums text-muted-foreground">{n.comments}</span>
        </div>
      ))}
    </div>
  );
}

// ── MemberActivityTable ───────────────────────────────────────────────────────

function MemberActivityTable({ members }: { members: MemberActivity[] }) {
  const maxTotal = Math.max(...members.map((m) => m.total), 1);

  return (
    <div className="space-y-2.5">
      {members.map((m) => (
        <div key={m.user_id} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MemberAvatar name={m.name} />
              <span className="font-medium truncate">{m.name}</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground shrink-0">
              <span title="Notes created">{m.notes_created} notes</span>
              <span title="Edits">{m.edits} edits</span>
              <span title="Comments">{m.comments} comments</span>
            </div>
          </div>
          {/* Activity bar */}
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60 transition-all duration-500"
              style={{ width: `${(m.total / maxTotal) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {members.every((m) => m.total === 0) && (
        <p className="text-xs text-muted-foreground/50 text-center py-4">No activity in this period</p>
      )}
    </div>
  );
}

function MemberAvatar({ name }: { name: string }) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0"
      style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
    >
      {initials}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function aggregateAIByAction(
  data: { date: string; count: number; by_action: Record<string, number> }[],
): { name: string; value: number }[] {
  const totals: Record<string, number> = {};
  for (const d of data) {
    for (const [action, count] of Object.entries(d.by_action)) {
      totals[action] = (totals[action] ?? 0) + count;
    }
  }
  const LABELS: Record<string, string> = {
    summarize: 'Summarize',
    rewrite: 'Rewrite',
    improve_writing: 'Improve',
    grammar_correction: 'Grammar',
    expand_section: 'Expand',
    shorten_section: 'Shorten',
  };
  return Object.entries(totals)
    .map(([k, v]) => ({ name: LABELS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value);
}
