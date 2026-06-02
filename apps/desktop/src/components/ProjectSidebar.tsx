/**
 * ProjectSidebar — Codex/AG-UI-style project + session browser.
 *
 * Wider sidebar (w-60) listing projects with their session threads.
 * Search, project navigation, inline thread switching.
 */

import React, { useState, useMemo } from "react";
import {
  Folder,
  Plus,
  Settings,
  Home,
  Trash2,
  Search,
  MessageSquare,
  Bot,
} from "lucide-react";
import { useProjectStore } from "../stores/projectStore";
import { useSessionStore } from "../stores/sessionStore";

interface ProjectSidebarProps {
  onAddProject: () => void;
}

export function ProjectSidebar({ onAddProject }: ProjectSidebarProps) {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const removeProject = useProjectStore((s) => s.removeProject);

  const sessionsMap = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  );

  // Filter projects by search
  const projectList = useMemo(() => {
    let list = Object.values(projects).sort(
      (a, b) => b.lastOpened - a.lastOpened,
    );
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
      );
    }
    return list;
  }, [projects, searchQuery]);

  // Get sessions for a project
  const getProjectSessions = (threadIds: string[]) => {
    return threadIds
      .map((id) => sessionsMap[id])
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  };

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col w-60 h-full bg-surface-sidebar border-r border-border flex-shrink-0">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <Bot size={16} className="text-brand-500" />
        <span className="text-sm font-semibold text-text-primary">
          agent-ui
        </span>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects..."
            className="w-full bg-surface-panel border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {projectList.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <p className="text-xs text-text-muted">
              {searchQuery ? "No matching projects" : "No projects yet"}
            </p>
          </div>
        ) : (
          projectList.map((project) => {
            const isActive = activeProjectId === project.id;
            const isExpanded = expandedProjects.has(project.id);
            const projectSessions = getProjectSessions(project.threadIds);

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  onClick={() => {
                    setActiveProject(project.id);
                    toggleProject(project.id);
                  }}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    isActive
                      ? "bg-surface-hover text-text-primary"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  }`}
                >
                  <Folder
                    size={14}
                    className={`flex-shrink-0 ${
                      isActive ? "text-brand-500" : "text-text-muted"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {project.name}
                    </div>
                    <div className="text-[10px] text-text-muted font-mono truncate">
                      {project.path}
                    </div>
                  </div>
                  {project.threadIds.length > 0 && (
                    <span className="text-[9px] text-text-muted bg-surface-panel px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {project.threadIds.length}
                    </span>
                  )}
                </div>

                {/* Session threads (expandable) */}
                {isExpanded && projectSessions.length > 0 && (
                  <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-border pl-2">
                    {projectSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => {
                          setActiveProject(project.id);
                          setActiveSession(session.id);
                        }}
                        className={`group flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors ${
                          activeSessionId === session.id
                            ? "bg-brand-500/10 text-text-primary"
                            : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
                        }`}
                      >
                        <MessageSquare size={10} className="flex-shrink-0" />
                        <span className="text-[11px] truncate">
                          {session.title}
                        </span>
                        {session.status === "working" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-border px-2 py-2">
        <button
          onClick={onAddProject}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <Plus size={14} />
          <span>Add Project</span>
        </button>
        <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

export default ProjectSidebar;
