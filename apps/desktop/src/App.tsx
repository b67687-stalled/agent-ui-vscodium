/**
 * agent-ui — Main application shell.
 *
 * Clean architecture: ProjectSidebar | TopBar + ChatPanel + ReviewPanel
 * ChatPanel uses CopilotKit V2 components (the official AG-UI reference UI).
 */

import React, { useState, useCallback, useRef } from "react";
import { Tab, Sender } from "./types";
import ProjectSidebar from "./components/ProjectSidebar";
import TopBar from "./components/TopBar";
import { ReviewPanel } from "./components/ReviewPanel";
import { CustomChatPanel } from "./components/CustomChatPanel";
import ProjectSelector from "./components/ProjectSelector";
import ConfigPanel from "./components/ConfigPanel";
import {
  useSessionStore,
  createSessionFromTask,
  type MessageAttachment,
} from "./stores/sessionStore";
import { useProjectStore } from "./stores/projectStore";
import * as v2Api from "./services/v2Api";
import { useAgUiStream } from "./hooks/useAgUiStream";

const App: React.FC = () => {
  const activeProject = useProjectStore((s) => s.getActiveProject());
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const addProject = useProjectStore((s) => s.addProject);
  const addThreadToProject = useProjectStore((s) => s.addThreadToProject);
  const removeThreadFromProject = useProjectStore(
    (s) => s.removeThreadFromProject,
  );

  const [agentCommand, setAgentCommand] = useState<string[] | undefined>(
    undefined,
  );
  const [showProjectSelector, setShowProjectSelector] = useState(false);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const setActive = useSessionStore((s) => s.setActiveSession);
  const removeSession = useSessionStore((s) => s.removeSession);

  const { startRun, cancelRun, sendApproval, isStreaming } = useAgUiStream();

  const activeSession = React.useMemo(
    () => (activeSessionId ? sessions[activeSessionId] : undefined),
    [activeSessionId, sessions],
  );

  const activeStoreSession = useSessionStore((s) =>
    activeSessionId ? s.sessions[activeSessionId] : undefined,
  );

  const [currentAgent, setCurrentAgent] = useState<string>("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const [defaultAgentId, setDefaultAgentId] = useState(
    () => localStorage.getItem("acp-ui-default-agent") || "default",
  );
  const handleDefaultAgentChange = useCallback((agentId: string) => {
    setDefaultAgentId(agentId);
    if (agentId) {
      localStorage.setItem("acp-ui-default-agent", agentId);
    } else {
      localStorage.removeItem("acp-ui-default-agent");
    }
  }, []);

  // Draggable divider
  const [chatWidthPercent, setChatWidthPercent] = useState(55);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = (x / rect.width) * 100;
      setChatWidthPercent(Math.min(75, Math.max(25, percent)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleDividerDoubleClick = useCallback(() => {
    setChatWidthPercent(50);
  }, []);

  const loadSessionHistory = useCallback(async (taskId: string) => {
    try {
      const { messages: historyMsgs } = await v2Api.getMessages(taskId);
      if (historyMsgs.length === 0) return;
      const chatMessages = historyMsgs.map((m: any) => {
        if (m.role === "tool") {
          return {
            role: "tool" as const,
            content: m.toolPurpose || `Tool: ${m.toolName}`,
            timestamp: Date.now(),
            toolCall: {
              toolCallId: `history-${Math.random().toString(36).slice(2)}`,
              toolName: m.toolName || "unknown",
              parameters: m.toolParameters || {},
              status: "completed" as const,
            },
          };
        }
        return {
          role: m.role as "user" | "agent",
          content: m.content,
          timestamp: Date.now(),
        };
      });
      useSessionStore.getState().setMessages(taskId, chatMessages);
    } catch (err) {
      console.debug("[App] No history for task:", taskId, err);
    }
  }, []);

  // Load tasks from bridge on mount
  React.useEffect(() => {
    v2Api
      .listTasks()
      .then(({ tasks }) => {
        for (const t of tasks) {
          if (!sessions[t.taskId]) {
            addSession(
              createSessionFromTask(t.taskId, t.agentSessionId, t.cwd, {
                title: t.title,
              }),
            );
          }
        }
      })
      .catch((err) => console.error("[App] Failed to list tasks:", err));
  }, []);

  const handleCreateTask = useCallback(
    async (cwd: string, resumeSessionId?: string) => {
      setIsCreatingSession(true);
      try {
        const projectId = addProject(cwd);
        const resp = await v2Api.createTask(cwd, {
          resumeSessionId,
          mode: defaultAgentId || undefined,
          agentCommand,
        });
        const session = createSessionFromTask(
          resp.taskId,
          resp.agentSessionId,
          cwd,
          {
            modes: resp.modes,
            models: resp.models,
            currentModeId: resp.currentModeId,
          },
        );
        addSession(session);
        addThreadToProject(projectId, session.id);
        setActive(session.id);
        if (resumeSessionId) {
          await loadSessionHistory(resp.taskId);
        }
      } catch (err) {
        console.error("[App] Failed to create task:", err);
      } finally {
        setIsCreatingSession(false);
      }
    },
    [
      addSession,
      setActive,
      loadSessionHistory,
      defaultAgentId,
      agentCommand,
      addProject,
      addThreadToProject,
    ],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try {
        await v2Api.deleteTask(taskId);
        const project = activeProject;
        if (project) {
          removeThreadFromProject(project.id, taskId);
        }
        removeSession(taskId);
      } catch (err) {
        console.error("[App] Failed to delete task:", err);
      }
    },
    [removeSession, activeProject, removeThreadFromProject],
  );

  const handleProjectSelected = useCallback(
    (path: string, cmd?: string[]) => {
      addProject(path);
      if (cmd) setAgentCommand(cmd);
      setShowProjectSelector(false);
    },
    [addProject],
  );

  const handleAgentChange = (agent: string) => {
    if (activeSession && agent) {
      v2Api.setMode(activeSession.id, agent).catch(console.error);
      useSessionStore
        .getState()
        .updateSession(activeSession.id, { currentModeId: agent });
    }
    setCurrentAgent(agent);
  };

  const handleModelChange = (modelId: string) => {
    if (activeSession && modelId) {
      v2Api.setModel(activeSession.id, modelId).catch(console.error);
      useSessionStore
        .getState()
        .updateSession(activeSession.id, { model: modelId });
    }
  };

  const projectCount = Object.keys(projects).length;
  const currentProjectPath = activeProject?.path || "";

  return (
    <div className="flex w-screen h-screen bg-surface-base text-text-primary font-sans">
      <ProjectSidebar onAddProject={() => setShowProjectSelector(true)} />

      <div className="flex-1 flex flex-col">
        {projectCount > 0 && activeProject && (
          <TopBar
            activeSessionId={activeSession?.id || null}
            currentModel={activeSession?.model || "auto"}
            currentMode={activeSession?.currentModeId || "code"}
            displayAgent={currentAgent || "Agent"}
            currentAgentDescription={
              activeStoreSession?.modes?.find(
                (m) =>
                  m.id === (activeStoreSession?.currentModeId || "default"),
              )?.description
            }
            availableModels={activeStoreSession?.models}
            onModelChange={handleModelChange}
            onAgentChange={handleAgentChange}
            onOpenConfig={() => {}}
          />
        )}

        {projectCount === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-surface-elevated border border-border flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-semibold mb-2 text-text-primary">
                Welcome to agent-ui
              </h1>
              <p className="text-sm text-text-secondary mb-6">
                Add a project to get started.
              </p>
              <button
                onClick={() => setShowProjectSelector(true)}
                className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Add Project
              </button>
            </div>
          </div>
        ) : !activeProject ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-text-muted text-sm">
              Select a project from the sidebar
            </p>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="flex-1 flex overflow-hidden p-1.5 gap-1.5"
          >
            {/* Chat panel — uses CopilotKit V2 components via CopilotPanel */}
            <div
              style={{ width: `${chatWidthPercent}%` }}
              className="flex-shrink-0 h-full rounded-xl overflow-hidden border border-border bg-surface-panel"
            >
              <CustomChatPanel
                session={activeSession}
                activeSessionId={activeSession?.id || null}
                isStreaming={isStreaming}
                onNewChat={() =>
                  !isCreatingSession && handleCreateTask(currentProjectPath)
                }
                onSendMessage={async (text) => {
                  if (activeSession) {
                    await startRun(activeSession.id, text);
                  }
                }}
              />
            </div>

            {/* Draggable divider */}
            <div
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDividerDoubleClick}
              className="flex-shrink-0 w-2 cursor-col-resize relative z-50 flex items-center justify-center -mx-1"
            >
              <div className="w-1 h-12 rounded-full bg-border group-hover:bg-brand-500/60 group-active:bg-brand-500 transition-colors" />
            </div>

            {/* Review panel */}
            <div
              style={{ width: `${100 - chatWidthPercent}%` }}
              className="flex-shrink-0 h-full rounded-xl overflow-hidden border border-border"
            >
              <ReviewPanel projectDir={currentProjectPath} />
            </div>
          </div>
        )}
      </div>

      {showProjectSelector && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-elevated border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <ProjectSelector
              onProjectSelect={handleProjectSelected}
              onClose={() => setShowProjectSelector(false)}
            />
          </div>
        </div>
      )}

      <ConfigPanel
        isOpen={false}
        onClose={() => {}}
        activeTool="agent"
        defaultAgentId={defaultAgentId}
        onDefaultAgentChange={handleDefaultAgentChange}
        availableAgents={activeSession?.modes || []}
      />
    </div>
  );
};

export default App;
