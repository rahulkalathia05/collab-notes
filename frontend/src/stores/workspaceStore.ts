import { create } from 'zustand';
import type { Workspace } from '@/types';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspace: (workspace: Workspace | null) => void;
  addWorkspace: (workspace: Workspace) => void;
  updateWorkspace: (id: string, data: Partial<Workspace>) => void;
  removeWorkspace: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspace: null,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  addWorkspace: (workspace) =>
    set((state) => ({ workspaces: [workspace, ...state.workspaces] })),
  updateWorkspace: (id, data) =>
    set((state) => ({
      workspaces: state.workspaces.map((ws) => (ws.id === id ? { ...ws, ...data } : ws)),
    })),
  removeWorkspace: (id) =>
    set((state) => ({ workspaces: state.workspaces.filter((ws) => ws.id !== id) })),
}));
