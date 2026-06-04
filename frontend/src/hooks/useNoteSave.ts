'use client';

/**
 * useNoteSave — production-grade autosave for a single note.
 *
 * Features
 * ────────
 * • Debounce (default 2 s) — rapid edits coalesce into one PATCH
 * • Change merging — title + content updates batched; one request per flush
 * • Concurrent-save guard — a second request never starts until the first finishes
 * • Exponential back-off retry — 2 s → 4 s → 8 s, up to 3 total attempts
 * • Conflict detection — 409 triggers one automatic silent retry (clear
 *   expectedUpdatedAt); if that also fails, phase moves to 'error'
 * • Optimistic concurrency — sends expected_updated_at so the server can
 *   detect and reject stale writes from other sessions
 * • Online / offline awareness — pauses debounce while offline, flushes on reconnect
 * • Phase state machine for rich UI status display
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { noteService } from '@/services/noteService';
import type { Note } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type Changes = { title?: string; content?: Record<string, unknown> | null };

export type SavePhase =
  | 'idle'      // nothing pending, no error
  | 'pending'   // debounce timer running
  | 'saving'    // HTTP request in flight
  | 'retrying'  // waiting before retry (back-off)
  | 'saved'     // last save succeeded
  | 'error'     // all retries exhausted
  | 'conflict'; // 409 + auto-retry failed

export interface UseNoteSaveReturn {
  phase: SavePhase;
  isSaving: boolean;       // phase === 'saving'
  isDirty: boolean;        // changes not yet persisted
  lastSavedAt: Date | null;
  saveError: string | null;
  retryIn: number;         // seconds until next retry attempt
  queueSave: (changes: Changes) => void;
  flush: () => Promise<void>;
  retrySave: () => void;   // manual retry after 'error' or 'conflict'
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isConflict(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 409
  );
}

function extractServerAt(err: unknown): string | undefined {
  try {
    return (
      err as { response: { data: { detail: { server_updated_at: string } } } }
    ).response.data.detail.server_updated_at;
  } catch {
    return undefined;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNoteSave(
  workspaceId: string,
  noteId: string,
  onSaved: (updated: Note) => void,
  delay = 2_000,
): UseNoteSaveReturn {
  // ── UI state ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);

  // ── Internal refs ─────────────────────────────────────────────────────────
  const pendingRef = useRef<Changes | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const isOnlineRef = useRef(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Stale-closure-safe identity refs
  const workspaceIdRef = useRef(workspaceId);
  const noteIdRef = useRef(noteId);
  const onSavedRef = useRef(onSaved);
  workspaceIdRef.current = workspaceId;
  noteIdRef.current = noteId;
  onSavedRef.current = onSaved;

  // expectedUpdatedAt: the server-side updated_at after the last successful
  // save. Sent with every subsequent request for conflict detection.
  const expectedAtRef = useRef<string | undefined>(undefined);

  // ── Safe state setters ────────────────────────────────────────────────────

  const set = useCallback((p: SavePhase) => { if (mountedRef.current) setPhase(p); }, []);

  const clearRetryCountdown = useCallback(() => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (retryIntervalRef.current) { clearInterval(retryIntervalRef.current); retryIntervalRef.current = null; }
    if (mountedRef.current) setRetryIn(0);
  }, []);

  // ── Core save (single attempt) ────────────────────────────────────────────

  const attemptSave = useCallback(
    async (changes: Changes, attempt: number): Promise<'ok' | 'retry' | 'conflict' | 'failed'> => {
      if (!mountedRef.current) return 'failed';
      set('saving');

      try {
        const payload = {
          ...changes,
          ...(expectedAtRef.current ? { expected_updated_at: expectedAtRef.current } : {}),
        };
        const updated = await noteService.update(
          workspaceIdRef.current,
          noteIdRef.current,
          payload,
        );
        if (!mountedRef.current) return 'ok';
        expectedAtRef.current = updated.updated_at;
        onSavedRef.current(updated);
        if (mountedRef.current) {
          setLastSavedAt(new Date());
          setSaveError(null);
          set(pendingRef.current ? 'pending' : 'saved');
        }
        return 'ok';
      } catch (err: unknown) {
        if (!mountedRef.current) return 'failed';
        if (isConflict(err)) {
          // Sync our expectedAt to what the server has, then signal caller
          const serverAt = extractServerAt(err);
          if (serverAt) expectedAtRef.current = serverAt;
          return 'conflict';
        }
        return attempt < RETRY_DELAYS_MS.length ? 'retry' : 'failed';
      }
    },
    [set],
  );

  // ── Save with retry + back-off ────────────────────────────────────────────

  const executeSave = useCallback(
    async (changes: Changes): Promise<void> => {
      clearRetryCountdown();

      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (!mountedRef.current) return;

        const outcome = await attemptSave(changes, attempt);

        if (outcome === 'ok') return;

        if (outcome === 'conflict') {
          if (attempt === 0) {
            // Auto-resolve: the server gave us the updated timestamp; retry
            // once more without the guard (we already updated expectedAtRef).
            continue;
          }
          // Second conflict (very unlikely) — surface to user
          if (mountedRef.current) {
            set('conflict');
            setSaveError('This note was saved by another session. Click "Retry" to overwrite with your changes.');
          }
          return;
        }

        if (outcome === 'failed') {
          if (mountedRef.current) {
            set('error');
            setSaveError('Could not save. Check your connection and try again.');
          }
          return;
        }

        // outcome === 'retry' — back-off then loop
        if (!mountedRef.current) return;
        const delayMs = RETRY_DELAYS_MS[attempt];
        let remaining = Math.ceil(delayMs / 1000);
        set('retrying');
        if (mountedRef.current) setRetryIn(remaining);

        await new Promise<void>((resolve) => {
          retryIntervalRef.current = setInterval(() => {
            remaining -= 1;
            if (mountedRef.current) setRetryIn(Math.max(0, remaining));
          }, 1_000);
          retryTimerRef.current = setTimeout(() => {
            clearRetryCountdown();
            resolve();
          }, delayMs);
        });
      }
    },
    [attemptSave, clearRetryCountdown, set],
  );

  // ── Drain queue (concurrent-save guard) ───────────────────────────────────

  const drainQueue = useCallback(async (): Promise<void> => {
    if (inFlightRef.current || !mountedRef.current) return;
    const changes = pendingRef.current;
    if (!changes) return;

    pendingRef.current = null;
    inFlightRef.current = true;
    try {
      await executeSave(changes);
    } finally {
      inFlightRef.current = false;
      // If more changes arrived during the save, start another round
      if (pendingRef.current && mountedRef.current) void drainQueue();
    }
  }, [executeSave]);

  // ── Public API ────────────────────────────────────────────────────────────

  const queueSave = useCallback(
    (changes: Changes) => {
      pendingRef.current = { ...pendingRef.current, ...changes };
      if (mountedRef.current) { set('pending'); setSaveError(null); }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!isOnlineRef.current) return; // will flush when back online

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void drainQueue();
      }, delay);
    },
    [set, drainQueue, delay],
  );

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    await drainQueue();
  }, [drainQueue]);

  const retrySave = useCallback(() => {
    clearRetryCountdown();
    if (mountedRef.current) setSaveError(null);
    // If there are pending local changes, save them; otherwise reset to idle
    if (pendingRef.current) {
      void drainQueue();
    } else {
      set('idle');
    }
  }, [clearRetryCountdown, drainQueue, set]);

  // ── Online / offline ──────────────────────────────────────────────────────

  useEffect(() => {
    const onOnline = () => {
      isOnlineRef.current = true;
      if (pendingRef.current) void drainQueue();
    };
    const onOffline = () => {
      isOnlineRef.current = false;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [drainQueue]);

  // ── Reset when navigating to a different note ────────────────────────────

  useEffect(() => {
    pendingRef.current = null;
    expectedAtRef.current = undefined;
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    clearRetryCountdown();
    if (mountedRef.current) {
      setPhase('idle');
      setSaveError(null);
      setLastSavedAt(null);
      setRetryIn(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearRetryCountdown();
    };
  }, [clearRetryCountdown]);

  return {
    phase,
    isSaving: phase === 'saving',
    isDirty: phase === 'pending' || (phase !== 'saving' && !!pendingRef.current),
    lastSavedAt,
    saveError,
    retryIn,
    queueSave,
    flush,
    retrySave,
  };
}
