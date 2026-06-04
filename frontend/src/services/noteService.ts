import api from '@/lib/api';
import type { Note, NoteVersion } from '@/types';

const base = (wid: string) => `/api/v1/workspaces/${wid}/notes`;

export const noteService = {
  list: async (workspaceId: string): Promise<Note[]> => {
    const res = await api.get<Note[]>(base(workspaceId));
    return res.data;
  },

  get: async (workspaceId: string, noteId: string): Promise<Note> => {
    const res = await api.get<Note>(`${base(workspaceId)}/${noteId}`);
    return res.data;
  },

  create: async (
    workspaceId: string,
    data: { title?: string; content?: Record<string, unknown> | null }
  ): Promise<Note> => {
    const res = await api.post<Note>(base(workspaceId), data);
    return res.data;
  },

  update: async (
    workspaceId: string,
    noteId: string,
    data: { title?: string; content?: Record<string, unknown> | null; expected_updated_at?: string }
  ): Promise<Note> => {
    const res = await api.patch<Note>(`${base(workspaceId)}/${noteId}`, data);
    return res.data;
  },

  delete: async (workspaceId: string, noteId: string): Promise<void> => {
    await api.delete(`${base(workspaceId)}/${noteId}`);
  },

  pin: async (workspaceId: string, noteId: string): Promise<Note> => {
    const res = await api.post<Note>(`${base(workspaceId)}/${noteId}/pin`);
    return res.data;
  },

  // ── version history ────────────────────────────────────────────────────────

  listVersions: async (workspaceId: string, noteId: string): Promise<NoteVersion[]> => {
    const res = await api.get<NoteVersion[]>(`${base(workspaceId)}/${noteId}/versions`);
    return res.data;
  },

  createVersion: async (
    workspaceId: string,
    noteId: string,
    label?: string
  ): Promise<NoteVersion> => {
    const res = await api.post<NoteVersion>(`${base(workspaceId)}/${noteId}/versions`, { label });
    return res.data;
  },

  getVersion: async (workspaceId: string, noteId: string, versionId: string): Promise<NoteVersion> => {
    const res = await api.get<NoteVersion>(`${base(workspaceId)}/${noteId}/versions/${versionId}`);
    return res.data;
  },

  updateVersionLabel: async (
    workspaceId: string,
    noteId: string,
    versionId: string,
    label: string,
  ): Promise<NoteVersion> => {
    const res = await api.patch<NoteVersion>(
      `${base(workspaceId)}/${noteId}/versions/${versionId}`,
      { label },
    );
    return res.data;
  },

  deleteVersion: async (workspaceId: string, noteId: string, versionId: string): Promise<void> => {
    await api.delete(`${base(workspaceId)}/${noteId}/versions/${versionId}`);
  },

  restoreVersion: async (
    workspaceId: string,
    noteId: string,
    versionId: string
  ): Promise<Note> => {
    const res = await api.post<Note>(
      `${base(workspaceId)}/${noteId}/versions/${versionId}/restore`
    );
    return res.data;
  },
};
