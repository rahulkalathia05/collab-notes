'use client';

import {
  AlertCircle,
  CheckSquare,
  ChevronRight,
  Lightbulb,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAISummarize } from '@/hooks/useAISummarize';
import type { SummaryResult } from '@/hooks/useAISummarize';
import { cn } from '@/lib/utils';

interface AIPanelProps {
  noteId: string;
  workspaceId: string;
  onClose: () => void;
}

/**
 * Right-side panel that shows AI-generated note summarization.
 *
 * States:
 *   idle      → prompt to summarize
 *   streaming → live token stream with progress indicator
 *   done      → organized sections (summary / key points / action items)
 *   error     → error message with retry button
 */
export function AIPanel({ noteId, workspaceId, onClose }: AIPanelProps) {
  const { phase, streamText, result, error, summarize, reset } = useAISummarize();

  const handleSummarize = () => summarize(noteId, workspaceId);

  return (
    <aside
      className="
        flex flex-col w-80 shrink-0 border-l bg-background
        overflow-hidden animate-in slide-in-from-right-4 duration-200
      "
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Summary</span>
        </div>
        <div className="flex items-center gap-0.5">
          {(phase === 'done' || phase === 'error') && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={reset}
              title="Start over"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {phase === 'idle' && <IdleState onSummarize={handleSummarize} />}
        {phase === 'streaming' && <StreamingState text={streamText} />}
        {phase === 'done' && result && <DoneState result={result} onRedo={handleSummarize} />}
        {phase === 'error' && (
          <ErrorState message={error ?? 'Something went wrong'} onRetry={handleSummarize} />
        )}
      </div>
    </aside>
  );
}

// ── Phase views ───────────────────────────────────────────────────────────────

function IdleState({ onSummarize }: { onSummarize: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">Summarize this note</p>
        <p className="text-xs text-muted-foreground mt-1">
          Get a summary, key points, and action items in seconds.
        </p>
      </div>
      <Button size="sm" onClick={onSummarize} className="w-full">
        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
        Generate summary
      </Button>
    </div>
  );
}

function StreamingState({ text }: { text: string }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Analyzing note…</span>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono text-[11px] bg-muted/40 rounded-md p-3 min-h-24">
        {text || <span className="opacity-40">Waiting for response…</span>}
      </div>
    </div>
  );
}

function DoneState({
  result,
  onRedo,
}: {
  result: SummaryResult;
  onRedo: () => void;
}) {
  return (
    <div className="p-4 space-y-5">
      {/* Summary */}
      <Section
        icon={<ChevronRight className="w-3.5 h-3.5 text-blue-500" />}
        title="Summary"
        accent="blue"
      >
        <p className="text-sm leading-relaxed text-foreground">{result.summary}</p>
      </Section>

      {result.keyPoints.length > 0 && (
        <>
          <Separator />
          <Section
            icon={<Lightbulb className="w-3.5 h-3.5 text-amber-500" />}
            title="Key Points"
            accent="amber"
          >
            <ul className="space-y-2">
              {result.keyPoints.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                    aria-hidden
                  />
                  <span className="leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {result.actionItems.length > 0 && (
        <>
          <Separator />
          <Section
            icon={<CheckSquare className="w-3.5 h-3.5 text-green-500" />}
            title="Action Items"
            accent="green"
          >
            <ul className="space-y-2">
              {result.actionItems.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span
                    className="mt-0.5 w-4 h-4 rounded border border-green-400 shrink-0"
                    aria-hidden
                  />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      <Separator />
      <Button
        variant="ghost"
        size="sm"
        onClick={onRedo}
        className="w-full text-muted-foreground text-xs"
      >
        <RotateCcw className="w-3 h-3 mr-1.5" />
        Re-generate
      </Button>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-full">
        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
        Try again
      </Button>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: 'blue' | 'amber' | 'green';
  children: React.ReactNode;
}) {
  const borderMap = {
    blue: 'border-blue-200 dark:border-blue-900',
    amber: 'border-amber-200 dark:border-amber-900',
    green: 'border-green-200 dark:border-green-900',
  };

  return (
    <div className={cn('pl-3 border-l-2', borderMap[accent])}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}
