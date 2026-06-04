'use client';

import { useCallback, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Eraser,
  Loader2,
  PenLine,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAIWriter, type WritingAction, type WritingAssistResult } from '@/hooks/useAIWriter';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Action definitions ────────────────────────────────────────────────────────

interface ActionDef {
  id: WritingAction;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const ACTIONS: ActionDef[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Rewrite with better clarity and structure',
    icon: <PenLine className="w-3.5 h-3.5" />,
  },
  {
    id: 'improve_writing',
    label: 'Improve',
    description: 'Improve flow, word choice, and readability',
    icon: <Sparkles className="w-3.5 h-3.5" />,
  },
  {
    id: 'grammar_correction',
    label: 'Grammar',
    description: 'Fix grammar, spelling, and punctuation',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  {
    id: 'expand_section',
    label: 'Expand',
    description: 'Add more detail and context',
    icon: <ZoomIn className="w-3.5 h-3.5" />,
  },
  {
    id: 'shorten_section',
    label: 'Shorten',
    description: 'Condense to be more concise',
    icon: <ZoomOut className="w-3.5 h-3.5" />,
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface AIWriterPanelProps {
  noteId: string;
  workspaceId: string;
  /** Returns the currently selected editor text + its position range */
  getEditorSelection: () => { text: string; from: number; to: number } | null;
  /** Replace the given range in the editor with new text */
  applyTextToEditor: (from: number, to: number, text: string) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AIWriterPanel({
  noteId,
  workspaceId,
  getEditorSelection,
  applyTextToEditor,
  onClose,
}: AIWriterPanelProps) {
  const { phase, streamText, result, error, transform, reset } = useAIWriter();

  const [selectedAction, setSelectedAction] = useState<WritingAction>('improve_writing');
  const [inputText, setInputText] = useState('');
  // Stored selection range so "Apply" can target the exact original position
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);

  const handleUseSelection = useCallback(() => {
    const sel = getEditorSelection();
    if (!sel || !sel.text.trim()) {
      toast.info('Select some text in the editor first');
      return;
    }
    setInputText(sel.text);
    setSelectionRange({ from: sel.from, to: sel.to });
  }, [getEditorSelection]);

  const handleTransform = useCallback(() => {
    if (!inputText.trim()) {
      toast.info('Enter or select text to transform');
      return;
    }
    transform({ noteId, workspaceId, action: selectedAction, selectedText: inputText });
  }, [inputText, noteId, workspaceId, selectedAction, transform]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }, []);

  const handleApply = useCallback(
    (text: string) => {
      if (!selectionRange) {
        toast.info('Use "Use Selection" first so the editor knows where to apply the text');
        return;
      }
      applyTextToEditor(selectionRange.from, selectionRange.to, text);
      toast.success('Applied to editor');
    },
    [selectionRange, applyTextToEditor],
  );

  const handleReset = useCallback(() => {
    reset();
    setInputText('');
    setSelectionRange(null);
  }, [reset]);

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l bg-background overflow-hidden animate-in slide-in-from-right-4 duration-200">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <PenLine className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Writing Assistant</span>
        </div>
        <div className="flex items-center gap-0.5">
          {(phase === 'done' || phase === 'error') && (
            <Button variant="ghost" size="icon-sm" onClick={handleReset} title="Start over">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close panel">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {phase === 'idle' && (
          <IdleState
            selectedAction={selectedAction}
            onSelectAction={setSelectedAction}
            inputText={inputText}
            onInputChange={setInputText}
            onUseSelection={handleUseSelection}
            onTransform={handleTransform}
          />
        )}
        {phase === 'streaming' && <StreamingState text={streamText} />}
        {phase === 'done' && result && (
          <DoneState
            result={result}
            onCopy={handleCopy}
            onApply={handleApply}
            hasSelection={selectionRange !== null}
            onRedo={handleTransform}
          />
        )}
        {phase === 'error' && (
          <ErrorState message={error ?? 'Something went wrong'} onRetry={handleTransform} />
        )}
      </div>
    </aside>
  );
}

// ── Phase views ───────────────────────────────────────────────────────────────

function IdleState({
  selectedAction,
  onSelectAction,
  inputText,
  onInputChange,
  onUseSelection,
  onTransform,
}: {
  selectedAction: WritingAction;
  onSelectAction: (a: WritingAction) => void;
  inputText: string;
  onInputChange: (t: string) => void;
  onUseSelection: () => void;
  onTransform: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Action picker */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</p>
        <div className="grid grid-cols-1 gap-1">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => onSelectAction(a.id)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors',
                selectedAction === a.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-foreground',
              )}
            >
              <span className="shrink-0">{a.icon}</span>
              <span className="font-medium">{a.label}</span>
              <span
                className={cn(
                  'text-xs ml-auto',
                  selectedAction === a.id ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {a.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Text input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Text</p>
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={onUseSelection}>
            <ChevronRight className="w-3 h-3" />
            Use selection
          </Button>
        </div>
        <textarea
          value={inputText}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Paste or select text from the editor…"
          rows={6}
          className="w-full resize-none rounded-md border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {inputText && (
          <button
            onClick={() => onInputChange('')}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eraser className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      <Button
        size="sm"
        className="w-full"
        onClick={onTransform}
        disabled={!inputText.trim()}
      >
        <Sparkles className="w-3.5 h-3.5 mr-1.5" />
        Transform
      </Button>
    </div>
  );
}

function StreamingState({ text }: { text: string }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Transforming text…</span>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap font-mono text-[11px] bg-muted/40 rounded-md p-3 min-h-32">
        {text || <span className="opacity-40">Waiting for response…</span>}
      </div>
    </div>
  );
}

function DoneState({
  result,
  onCopy,
  onApply,
  hasSelection,
  onRedo,
}: {
  result: WritingAssistResult;
  onCopy: (text: string) => void;
  onApply: (text: string) => void;
  hasSelection: boolean;
  onRedo: () => void;
}) {
  const actionDef = ACTIONS.find((a) => a.id === result.action);

  return (
    <div className="p-4 space-y-4">
      {/* Action badge */}
      {actionDef && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {actionDef.icon}
          <span>{actionDef.label}</span>
        </div>
      )}

      {/* Result text */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Result
        </p>
        <div className="rounded-md border bg-muted/20 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {result.result || <span className="text-muted-foreground italic">No result returned</span>}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onCopy(result.result)}
        >
          <ClipboardCopy className="w-3 h-3 mr-1" />
          Copy
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onApply(result.result)}
          disabled={!hasSelection}
          title={!hasSelection ? 'Use "Use Selection" before transforming to enable this' : undefined}
        >
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Apply
        </Button>
      </div>

      {!hasSelection && (
        <p className="text-[11px] text-muted-foreground/70 text-center">
          Select text in the editor and use "Use Selection" to enable Apply
        </p>
      )}

      {/* Changes list */}
      {result.changes.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Changes Made
            </p>
            <ul className="space-y-1.5">
              {result.changes.map((change, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-primary/60 shrink-0" aria-hidden />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>
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
        Re-run
      </Button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
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
