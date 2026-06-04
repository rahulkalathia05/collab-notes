'use client';

import { useCallback, useRef, useState } from 'react';
import Cookies from 'js-cookie';

export type WritingAction =
  | 'rewrite'
  | 'improve_writing'
  | 'grammar_correction'
  | 'expand_section'
  | 'shorten_section';

export interface WritingAssistResult {
  action: WritingAction;
  result: string;
  changes: string[];
}

type Phase = 'idle' | 'streaming' | 'done' | 'error';

interface UseAIWriterReturn {
  phase: Phase;
  streamText: string;
  result: WritingAssistResult | null;
  error: string | null;
  transform: (params: {
    noteId: string;
    workspaceId: string;
    action: WritingAction;
    selectedText: string;
  }) => void;
  reset: () => void;
  abort: () => void;
}

/**
 * Streams the AI writing-assist endpoint and parses the structured result.
 *
 * SSE events from the backend:
 *   {"text": "..."}                               → append to streamText
 *   {"type": "done", "action", "result",          → set result, phase → done
 *    "changes"}
 *   {"type": "error", "message": "..."}           → set error, phase → error
 */
export function useAIWriter(): UseAIWriterReturn {
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<WritingAssistResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setStreamText('');
    setResult(null);
    setError(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
  }, []);

  const transform = useCallback(
    async ({
      noteId,
      workspaceId,
      action,
      selectedText,
    }: {
      noteId: string;
      workspaceId: string;
      action: WritingAction;
      selectedText: string;
    }) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setPhase('streaming');
      setStreamText('');
      setResult(null);
      setError(null);

      const token = Cookies.get('access_token');
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8002';

      try {
        const res = await fetch(`${base}/api/v1/ai/writing-assist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            note_id: noteId,
            workspace_id: workspaceId,
            action,
            selected_text: selectedText,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value, { stream: true }).split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event.type === 'error') {
              setError((event.message as string) ?? 'Transform failed');
              setPhase('error');
              return;
            }

            if (event.type === 'done') {
              setResult({
                action: (event.action as WritingAction) ?? action,
                result: (event.result as string) ?? '',
                changes: (event.changes as string[]) ?? [],
              });
              setPhase('done');
              return;
            }

            if (typeof event.text === 'string') {
              setStreamText((prev) => prev + event.text);
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setPhase('error');
      }
    },
    [],
  );

  return { phase, streamText, result, error, transform, reset, abort };
}
