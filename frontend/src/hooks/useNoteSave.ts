'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { noteService } from '@/services/noteService';
import type { Note } from '@/types';

type Changes = {
  title?: string;
  content?: Record<string, unknown> | null;
};

interface UseNoteSaveReturn {
  isSaving: boolean;
  isDirty: boolean;
  lastSavedAt: Date | null;
  saveError: string | null;
  /** Merge changes and schedule a debounced PATCH. */
  queueSave: (changes: Changes) => void;
  /** Immediately flush any pending changes. Safe to call repeatedly. */
  flush: () => Promise<void>;
}

/**
 * Manages autosave for a single note — merges title and content changes into
 * one PATCH call so the editor never produces two competing in-flight requests.
 *
 * Wire-up for TipTap (Week 3):
 *   editor.on('update', () => queueSave({ content: editor.getJSON() }));
 */
export function useNoteSave(
  workspaceId: string,
  noteId: string,
  onSaved: (updated: Note) => void,
  delay = 2000,
): UseNoteSaveReturn {
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pending changes accumulate here until the debounce fires
  const pendingRef = useRef<Changes | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callbacks/ids in refs so closures inside setTimeout are always current
  const workspaceIdRef = useRef(workspaceId);
  const noteIdRef = useRef(noteId);
  const onSavedRef = useRef(onSaved);
  workspaceIdRef.current = workspaceId;
  noteIdRef.current = noteId;
  onSavedRef.current = onSaved;

  const doSave = useCallback(async (changes: Changes) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await noteService.update(
        workspaceIdRef.current,
        noteIdRef.current,
        changes,
      );
      onSavedRef.current(updated);
      setLastSavedAt(new Date());
      setIsDirty(false);
    } catch {
      setSaveError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const queueSave = useCallback(
    (changes: Changes) => {
      // Merge into pending so rapid title + content changes become one PATCH
      pendingRef.current = { ...pendingRef.current, ...changes };
      setIsDirty(true);
      setSaveError(null);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        const toSave = pendingRef.current;
        if (!toSave) return;
        pendingRef.current = null;
        await doSave(toSave);
      }, delay);
    },
    [doSave, delay],
  );

  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const toSave = pendingRef.current;
    if (!toSave) return;
    pendingRef.current = null;
    await doSave(toSave);
  }, [doSave]);

  // Cancel timeout on unmount (the component navigating away should call flush first)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { isSaving, isDirty, lastSavedAt, saveError, queueSave, flush };
}
