'use client';

import { useCallback, useRef, useState } from 'react';
import Cookies from 'js-cookie';

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}

type Phase = 'idle' | 'streaming' | 'done' | 'error';

interface UseAISummarizeReturn {
  phase: Phase;
  /** Raw accumulated SSE text — shown while streaming */
  streamText: string;
  /** Parsed structured result — available once phase === 'done' */
  result: SummaryResult | null;
  error: string | null;
  summarize: (noteId: string, workspaceId: string) => void;
  reset: () => void;
  abort: () => void;
}

/**
 * Streams the AI summarize endpoint and parses the structured result.
 *
 * SSE event shapes from the backend:
 *   {"text": "..."}                              → append to streamText
 *   {"type": "done", "summary", "key_points",   → set result, phase → done
 *    "action_items"}
 *   {"type": "error", "message": "..."}         → set error, phase → error
 */
export function useAISummarize(): UseAISummarizeReturn {
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<SummaryResult | null>(null);
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

  const summarize = useCallback(
    async (noteId: string, workspaceId: string) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setPhase('streaming');
      setStreamText('');
      setResult(null);
      setError(null);

      const token = Cookies.get('access_token');
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8002';

      try {
        const res = await fetch(`${base}/api/v1/ai/summarize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ note_id: noteId, workspace_id: workspaceId }),
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
              setError((event.message as string) ?? 'Summarization failed');
              setPhase('error');
              return;
            }

            if (event.type === 'done') {
              setResult({
                summary: (event.summary as string) ?? '',
                keyPoints: (event.key_points as string[]) ?? [],
                actionItems: (event.action_items as string[]) ?? [],
              });
              setPhase('done');
              return;
            }

            // Plain text chunk
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

  return { phase, streamText, result, error, summarize, reset, abort };
}
