'use client';

import { useEffect, useRef, useCallback } from 'react';

export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  delay = 2000
) {
  const savedValueRef = useRef(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (value === savedValueRef.current) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
      await onSaveRef.current(value);
      savedValueRef.current = value;
    }, delay);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [value, delay]);

  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (savedValueRef.current !== value) {
      await onSaveRef.current(value);
      savedValueRef.current = value;
    }
  }, [value]);

  return { flush };
}
