import { create } from 'zustand';
import type { Note } from '@/types';

interface EditorState {
  note: Note | null;
  isDirty: boolean;
  isSaving: boolean;
  setNote: (note: Note | null) => void;
  updateNote: (data: Partial<Note>) => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  note: null,
  isDirty: false,
  isSaving: false,
  setNote: (note) => set({ note, isDirty: false }),
  updateNote: (data) =>
    set((state) => ({
      note: state.note ? { ...state.note, ...data } : null,
      isDirty: true,
    })),
  setDirty: (isDirty) => set({ isDirty }),
  setSaving: (isSaving) => set({ isSaving }),
}));
