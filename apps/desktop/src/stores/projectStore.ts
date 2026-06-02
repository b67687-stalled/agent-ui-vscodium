/**
 * Project Store — manages projects and their thread associations.
 *
 * A project = a directory on disk. Threads = sessions created for that project.
 * This sits above the session store in the hierarchy.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Project {
  id: string;
  path: string;
  name: string;
  threadIds: string[];
  lastOpened: number;
}

interface ProjectState {
  projects: Record<string, Project>;
  activeProjectId: string | null;

  addProject: (path: string) => string;
  removeProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  addThreadToProject: (projectId: string, threadId: string) => void;
  removeThreadFromProject: (projectId: string, threadId: string) => void;
  getActiveProject: () => Project | undefined;
}

function projectIdFromPath(path: string): string {
  // Simple hash of the absolute path
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `proj_${Math.abs(hash).toString(36)}`;
}

function projectNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: null,

      addProject: (path: string) => {
        const id = projectIdFromPath(path);
        const existing = get().projects[id];
        if (existing) {
          // Update lastOpened and return existing id
          set((state) => ({
            projects: {
              ...state.projects,
              [id]: { ...existing, lastOpened: Date.now() },
            },
            activeProjectId: id,
          }));
          return id;
        }
        const project: Project = {
          id,
          path,
          name: projectNameFromPath(path),
          threadIds: [],
          lastOpened: Date.now(),
        };
        set((state) => ({
          projects: { ...state.projects, [id]: project },
          activeProjectId: id,
        }));
        return id;
      },

      removeProject: (id: string) => {
        set((state) => {
          const { [id]: _, ...rest } = state.projects;
          return {
            projects: rest,
            activeProjectId:
              state.activeProjectId === id ? null : state.activeProjectId,
          };
        });
      },

      setActiveProject: (id: string | null) => {
        set({ activeProjectId: id });
      },

      addThreadToProject: (projectId: string, threadId: string) => {
        set((state) => {
          const project = state.projects[projectId];
          if (!project || project.threadIds.includes(threadId)) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                threadIds: [...project.threadIds, threadId],
                lastOpened: Date.now(),
              },
            },
          };
        });
      },

      removeThreadFromProject: (projectId: string, threadId: string) => {
        set((state) => {
          const project = state.projects[projectId];
          if (!project) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...project,
                threadIds: project.threadIds.filter((t) => t !== threadId),
              },
            },
          };
        });
      },

      getActiveProject: () => {
        const state = get();
        if (!state.activeProjectId) return undefined;
        return state.projects[state.activeProjectId];
      },
    }),
    {
      name: "agent-ui-projects",
    },
  ),
);
