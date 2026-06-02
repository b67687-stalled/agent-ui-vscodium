/**
 * ReviewPanel — Git diff review panel (right sidebar).
 *
 * Shows changed files in a tree, inline diff view, and git actions.
 * Replaces the right-side placeholder in App.tsx.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  File,
  FilePlus,
  FileMinus,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  MessageSquare,
} from "lucide-react";
import {
  getGitStatus,
  getGitDiff,
  getGitBranches,
  gitStage,
  gitUnstage,
  gitDiscard,
  gitCommit,
  gitPush,
  gitCreatePR,
  type GitStatus,
  type GitStatusFile,
} from "../services/api";

// ============================================================================
// Types
// ============================================================================

type DiffScope = "uncommitted" | "all" | "last-turn";

interface Hunk {
  header: string;
  content: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

// ============================================================================
// Diff parser
// ============================================================================

function parseDiff(diffText: string): { files: Record<string, Hunk[]> } {
  const files: Record<string, Hunk[]> = {};
  let currentFile = "";
  let currentHunk: Hunk | null = null;

  for (const line of diffText.split("\n")) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (fileMatch) {
      currentFile = fileMatch[1];
      files[currentFile] = files[currentFile] || [];
      currentHunk = null;
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch && currentFile) {
      if (currentHunk) {
        files[currentFile].push(currentHunk);
      }
      currentHunk = {
        header: line,
        content: "",
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2] || "1"),
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4] || "1"),
      };
      continue;
    }

    if (currentHunk) {
      currentHunk.content += line + "\n";
    }
  }

  // Push last hunk
  if (currentHunk && currentFile) {
    files[currentFile].push(currentHunk);
  }

  return { files };
}

// ============================================================================
// DiffLine component
// ============================================================================

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+")) {
    return (
      <div className="flex text-xs font-mono leading-5">
        <span className="w-8 flex-shrink-0 text-right pr-2 text-emerald-700 select-none bg-emerald-950/40">
          +
        </span>
        <span className="flex-1 bg-emerald-950/20 text-emerald-300 px-1">
          {line.slice(1)}
        </span>
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="flex text-xs font-mono leading-5">
        <span className="w-8 flex-shrink-0 text-right pr-2 text-red-700 select-none bg-red-950/40">
          -
        </span>
        <span className="flex-1 bg-red-950/20 text-red-300 px-1">
          {line.slice(1)}
        </span>
      </div>
    );
  }
  if (line.startsWith("@@")) {
    return (
      <div className="flex text-xs font-mono leading-5">
        <span className="w-8 flex-shrink-0 text-right pr-2 text-text-muted select-none bg-surface-panel">
          {" "}
        </span>
        <span className="flex-1 bg-surface-panel text-text-secondary px-1">
          {line}
        </span>
      </div>
    );
  }
  // Context line
  return (
    <div className="flex text-xs font-mono leading-5">
      <span className="w-8 flex-shrink-0 text-right pr-2 text-text-muted select-none">
        {" "}
      </span>
      <span className="flex-1 text-text-secondary px-1">{line}</span>
    </div>
  );
}

// ============================================================================
// File icon
// ============================================================================

function FileStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "A":
      return <FilePlus size={14} className="text-emerald-400" />;
    case "D":
      return <FileMinus size={14} className="text-red-400" />;
    case "M":
      return <File size={14} className="text-blue-400" />;
    case "R":
      return <File size={14} className="text-purple-400" />;
    default:
      return <File size={14} className="text-text-secondary" />;
  }
}

function FileStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-900/50 text-emerald-400",
    M: "bg-blue-900/50 text-blue-400",
    D: "bg-red-900/50 text-red-400",
    R: "bg-purple-900/50 text-purple-400",
  };
  return (
    <span
      className={`text-[10px] font-mono px-1 rounded ${colors[status] || "bg-surface-hover text-text-secondary"}`}
    >
      {status}
    </span>
  );
}

// ============================================================================
// Main component
// ============================================================================

interface ReviewPanelProps {
  projectDir: string;
}

export function ReviewPanel({ projectDir }: ReviewPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prBase, setPrBase] = useState("main");
  const [creatingPR, setCreatingPR] = useState(false);
  const [prResult, setPrResult] = useState<string | null>(null);
  const [showPRForm, setShowPRForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load git status
  const loadStatus = useCallback(async () => {
    if (!projectDir) return;
    try {
      setLoading(true);
      const s = await getGitStatus(projectDir);
      setStatus(s);
      setError(null);
    } catch (err) {
      setError("Failed to load git status");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  // Load diff for selected file
  const loadDiff = useCallback(
    async (file: string) => {
      try {
        const result = await getGitDiff(projectDir, false, file);
        setDiffText(result.diff);
      } catch (err) {
        setDiffText("// Error loading diff");
        console.error(err);
      }
    },
    [projectDir],
  );

  // Initial load
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Load diff when file selected
  useEffect(() => {
    if (selectedFile) {
      loadDiff(selectedFile);
    } else {
      setDiffText("");
    }
  }, [selectedFile, loadDiff]);

  // Parse diff
  const parsedDiff = useMemo(() => {
    if (!diffText) return null;
    return parseDiff(diffText);
  }, [diffText]);

  // Build file tree
  const fileTree = useMemo(() => {
    if (!status) return [];
    const tree: Array<{ dir: string; files: GitStatusFile[] }> = [];
    const dirMap = new Map<string, GitStatusFile[]>();

    for (const file of status.files) {
      const parts = file.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push(file);
    }

    for (const [dir, files] of dirMap) {
      tree.push({ dir, files });
    }

    // Sort: root first, then alphabetical
    tree.sort((a, b) => {
      if (a.dir === ".") return -1;
      if (b.dir === ".") return 1;
      return a.dir.localeCompare(b.dir);
    });

    return tree;
  }, [status]);

  const totalAdditions = useMemo(() => {
    // Rough estimate from status — exact count comes from diff
    return (
      status?.files.filter((f) => f.status === "A" || f.status === "M")
        .length || 0
    );
  }, [status]);

  // Actions
  const handleStageFile = async (file: string) => {
    try {
      await gitStage(file, projectDir);
      await loadStatus();
    } catch (err) {
      console.error("Failed to stage:", err);
    }
  };

  const handleRevertFile = async (file: string) => {
    try {
      await gitDiscard(file, projectDir);
      await loadStatus();
      setSelectedFile(null);
    } catch (err) {
      console.error("Failed to revert:", err);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await gitCommit(commitMessage.trim(), projectDir);
      setCommitMessage("");
      await loadStatus();
    } catch (err) {
      console.error("Failed to commit:", err);
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setPushResult(null);
    try {
      const result = await gitPush(projectDir);
      setPushResult(result.success ? "Pushed!" : result.message);
    } catch (err) {
      setPushResult("Push failed");
    } finally {
      setPushing(false);
    }
  };

  const handleCreatePR = async () => {
    if (!prTitle.trim()) return;
    setCreatingPR(true);
    setPrResult(null);
    try {
      const result = await gitCreatePR(
        projectDir,
        prTitle.trim(),
        prBody.trim(),
        prBase,
      );
      if (result.success && result.url) {
        setPrResult(`PR created: ${result.url}`);
        setShowPRForm(false);
      } else {
        setPrResult(result.message || "Failed to create PR");
      }
    } catch (err) {
      setPrResult("PR creation failed");
    } finally {
      setCreatingPR(false);
    }
  };

  // Count stats from current diff
  const diffStats = useMemo(() => {
    if (!diffText) return { additions: 0, deletions: 0 };
    const added = (diffText.match(/^\+/gm) || []).length;
    const removed = (diffText.match(/^-/gm) || []).length;
    // Subtract hunk headers and ---/+++ lines
    return {
      additions: added,
      deletions: removed,
    };
  }, [diffText]);

  const stagedFiles = status?.files.filter((f) => f.staged) || [];
  const unstagedFiles = status?.files.filter((f) => !f.staged) || [];

  return (
    <div className="flex flex-col h-full bg-surface-panel text-text-primary text-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={14} className="text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {status?.branch || "—"}
          </span>
          {status && (
            <span className="text-[10px] text-text-secondary ml-auto">
              {status.ahead > 0 && `↑${status.ahead} `}
              {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={loadStatus}
            className="p-1 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto border-b border-border">
        {loading && !status && (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading...
          </div>
        )}

        {error && (
          <div className="px-4 py-8 text-center text-text-muted">
            <p className="text-xs">{error}</p>
          </div>
        )}

        {status && status.files.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-text-muted">
            <GitCommit size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs">No uncommitted changes</p>
          </div>
        )}

        {status && status.files.length > 0 && (
          <div className="py-1">
            {fileTree.map(({ dir, files }) => (
              <div key={dir}>
                {dir !== "." && (
                  <div className="px-4 py-1 text-[10px] text-text-muted uppercase tracking-wider font-medium">
                    {dir}
                  </div>
                )}
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-surface-hover transition-colors ${
                      selectedFile === file.path
                        ? "bg-blue-600/10 text-blue-300"
                        : ""
                    }`}
                  >
                    <FileStatusIcon status={file.status} />
                    <span className="flex-1 truncate text-xs">
                      {file.path.split("/").pop()}
                    </span>
                    <FileStatusBadge status={file.status} />
                    {file.staged && (
                      <span className="text-[9px] text-emerald-500 font-mono">
                        S
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/* Summary */}
            <div className="px-4 py-2 text-[10px] text-text-muted border-t border-border/50 mt-2">
              {status.files.length} file{status.files.length !== 1 ? "s" : ""}
              {unstagedFiles.length > 0 &&
                ` · ${unstagedFiles.length} unstaged`}
              {stagedFiles.length > 0 && ` · ${stagedFiles.length} staged`}
            </div>
          </div>
        )}
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto border-b border-border">
        {!selectedFile && (
          <div className="flex items-center justify-center h-full text-text-muted">
            <p className="text-xs">Select a file to view diff</p>
          </div>
        )}

        {selectedFile && parsedDiff && (
          <div className="py-1">
            {/* File actions */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface-elevated sticky top-0">
              <span className="text-[11px] text-text-secondary font-mono flex-1 truncate">
                {selectedFile}
              </span>
              <span className="text-[10px] text-text-muted font-mono">
                +{diffStats.additions} -{diffStats.deletions}
              </span>
            </div>

            {/* Hunks */}
            {Object.entries(parsedDiff.files).map(([filePath, hunks]) => (
              <div key={filePath}>
                {hunks.map((hunk, idx) => (
                  <div
                    key={idx}
                    className="border-b border-border/50 last:border-0"
                  >
                    <div className="px-3 py-1 bg-surface-panel/30">
                      <span className="text-[10px] text-text-muted font-mono">
                        {hunk.header}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      {hunk.content.split("\n").map((line, lineIdx) => (
                        <DiffLine key={lineIdx} line={line} />
                      ))}
                    </div>
                    {/* Hunk actions */}
                    <div className="flex items-center gap-1 px-3 py-1 bg-surface-base/30 border-t border-border/30">
                      <button
                        onClick={() => handleStageFile(selectedFile)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50 transition-colors"
                      >
                        <Check size={10} /> Accept
                      </button>
                      <button
                        onClick={() => handleRevertFile(selectedFile)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                      >
                        <X size={10} /> Reject
                      </button>
                      <span className="text-[9px] text-text-muted ml-auto">
                        (file-level action)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* File-level actions */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
              <button
                onClick={() => handleStageFile(selectedFile)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50 transition-colors"
              >
                <Check size={12} /> Accept File
              </button>
              <button
                onClick={() => handleRevertFile(selectedFile)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
              >
                <X size={12} /> Revert File
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Commit area */}
      <div className="px-4 py-3 border-t border-border">
        {/* Commit row */}
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder="Commit message..."
            className="flex-1 bg-surface-base border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500/50 transition-colors"
            disabled={committing}
          />
          <button
            onClick={handleCommit}
            disabled={
              !commitMessage.trim() || committing || unstagedFiles.length === 0
            }
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-brand-500 disabled:bg-surface-hover disabled:text-text-muted text-white transition-colors flex items-center gap-1"
          >
            {committing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitCommit size={12} />
            )}
            Commit
          </button>
        </div>

        {/* Push + PR row */}
        <div className="flex gap-2">
          <button
            onClick={handlePush}
            disabled={pushing || status?.files.length === 0}
            className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-surface-hover hover:bg-surface-hover disabled:bg-surface-panel disabled:text-text-muted text-text-primary transition-colors flex items-center justify-center gap-1"
            title="Push to remote"
          >
            {pushing ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <GitBranch size={10} />
            )}
            Push
          </button>
          <button
            onClick={() => setShowPRForm(!showPRForm)}
            disabled={!status?.isRepo}
            className="flex-1 px-2 py-1 rounded text-[10px] font-medium bg-surface-hover hover:bg-surface-hover disabled:bg-surface-panel disabled:text-text-muted text-text-primary transition-colors flex items-center justify-center gap-1"
          >
            <GitPullRequest size={10} />
            {showPRForm ? "Cancel" : "PR"}
          </button>
        </div>

        {/* Push result */}
        {pushResult && (
          <div
            className={`mt-2 text-[10px] ${pushResult === "Pushed!" ? "text-emerald-400" : "text-red-400"}`}
          >
            {pushResult}
          </div>
        )}

        {/* PR form */}
        {showPRForm && (
          <div className="mt-2 space-y-2 border border-border rounded-lg p-2 bg-surface-base/50">
            <input
              type="text"
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder="PR title..."
              className="w-full bg-surface-base border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500"
            />
            <textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full bg-surface-base border border-border rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 resize-none"
            />
            <div className="flex gap-2 items-center">
              <span className="text-[10px] text-text-muted">base:</span>
              <input
                type="text"
                value={prBase}
                onChange={(e) => setPrBase(e.target.value)}
                className="w-20 bg-surface-base border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none focus:border-brand-500"
              />
              <button
                onClick={handleCreatePR}
                disabled={!prTitle.trim() || creatingPR}
                className="ml-auto px-2 py-1 rounded text-[10px] font-medium bg-purple-600 hover:bg-brand-500 disabled:bg-surface-hover disabled:text-text-muted text-white transition-colors flex items-center gap-1"
              >
                {creatingPR ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <GitPullRequest size={10} />
                )}
                Create PR
              </button>
            </div>
            {prResult && (
              <div
                className={`text-[10px] ${prResult.startsWith("PR created") ? "text-emerald-400" : "text-red-400"}`}
              >
                {prResult.startsWith("PR created:") ? (
                  <a
                    href={prResult.replace("PR created: ", "")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-emerald-300"
                  >
                    {prResult}
                  </a>
                ) : (
                  prResult
                )}
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        {status && (
          <div className="flex items-center gap-2 mt-2 text-[10px] text-text-muted">
            <span>{status.files.length} changed</span>
            {stagedFiles.length > 0 && (
              <span className="text-emerald-500">
                {stagedFiles.length} staged
              </span>
            )}
            {!status.isRepo && (
              <span className="text-amber-500">Not a git repo</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewPanel;
