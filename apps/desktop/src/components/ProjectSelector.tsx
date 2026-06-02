import React, { useState, useEffect } from "react";
import { Bot, Folder, X } from "lucide-react";

interface ProjectSelectorProps {
  onProjectSelect: (path: string, agentCommand?: string[]) => void;
  onClose?: () => void;
}

const RECENT_PROJECTS_KEY = "agent-ui-recent-projects";
const MAX_RECENT_PROJECTS = 10;

const getRecentProjects = (): string[] => {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveRecentProject = (path: string): void => {
  try {
    const recent = getRecentProjects();
    const filtered = recent.filter((p) => p !== path);
    const updated = [path, ...filtered].slice(0, MAX_RECENT_PROJECTS);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save recent project:", e);
  }
};

const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  onProjectSelect,
  onClose,
}) => {
  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRecentProjects(getRecentProjects());
  }, []);

  const handleSubmit = () => {
    const trimmedPath = projectPath.trim();
    if (!trimmedPath) {
      setError("Please enter a project path");
      return;
    }
    if (!trimmedPath.startsWith("/") && !trimmedPath.match(/^[a-zA-Z]:\\/)) {
      setError("Please enter an absolute path");
      return;
    }
    setError(null);
    saveRecentProject(trimmedPath);
    onProjectSelect(trimmedPath);
  };

  const handleRecentSelect = (path: string) => {
    saveRecentProject(path);
    onProjectSelect(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape" && onClose) onClose();
  };

  return (
    <>
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X size={18} />
        </button>
      )}

      <div className="text-center mb-5">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
          <Folder size={24} className="text-blue-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-200">Add Project</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Enter the path to your project directory
        </p>
      </div>

      {/* Path Input */}
      <div className="mb-4">
        <input
          type="text"
          value={projectPath}
          onChange={(e) => {
            setProjectPath(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="/path/to/your/project"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
          autoFocus
        />
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </div>

      {/* Open Button */}
      <button
        onClick={handleSubmit}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
      >
        <Folder size={16} />
        Open Project
      </button>

      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 mb-2">Recent Projects</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentProjects.map((path, index) => (
              <button
                key={index}
                onClick={() => handleRecentSelect(path)}
                className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors truncate flex items-center gap-2"
                title={path}
              >
                <Folder size={14} className="flex-shrink-0 text-zinc-600" />
                <span className="truncate">{path}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default ProjectSelector;
