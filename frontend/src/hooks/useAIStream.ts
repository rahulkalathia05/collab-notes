'use client';

import { useState, useCallback, useRef } from 'react';
import Cookies from 'js-cookie';

interface UseAIStreamOptions {
  onChunk?: (chunk: string) => void;
  onDone?: (full: string) => void;
  onError?: (error: string) => void;
}

export function useAIStream({ onChunk, onDone, onError }: UseAIStreamOptions = {}) {
  const [output, setOutput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const callbacksRef = useRef({ onChunk, onDone, onError });
  callbacksRef.current = { onChunk, onDone, onError };

  const stream = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setOutput('');
    setIsStreaming(true);

    const token = Cookies.get('access_token');
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8002';

    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const { text } = JSON.parse(data) as { text: string };
            full += text;
            setOutput((prev) => prev + text);
            callbacksRef.current.onChunk?.(text);
          } catch {
            // malformed SSE line — skip
          }
        }
      }

      callbacksRef.current.onDone?.(full);
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Stream error';
        callbacksRef.current.onError?.(msg);
      }
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { output, isStreaming, stream, abort };
}
