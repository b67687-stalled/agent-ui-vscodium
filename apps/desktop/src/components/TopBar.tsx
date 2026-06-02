/**
 * TopBar — Dedicated bar for context indicator + model selector + agent info.
 *
 * Sits above the main split view, below the sidebar header.
 * Reads session store directly for context/model metadata.
 */

import React from "react";
import { Bot, SlidersHorizontal } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { ContextIndicator } from "./ContextIndicator";
import { ModelInfoBar } from "./ModelInfoBar";

interface TopBarProps {
  activeSessionId: string | null;
  currentModel?: string;
  currentMode?: string;
  displayAgent: string;
  currentAgentDescription?: string;
  availableModels?: Array<{ id: string; name: string }>;
  onModelChange?: (modelId: string) => void;
  onAgentChange?: (agentId: string) => void;
  onOpenConfig: () => void;
}

export function TopBar({
  activeSessionId,
  currentModel,
  currentMode,
  displayAgent,
  currentAgentDescription,
  availableModels,
  onModelChange,
  onAgentChange,
  onOpenConfig,
}: TopBarProps) {
  const activeStoreSession = useSessionStore((s) =>
    activeSessionId ? s.sessions[activeSessionId] : undefined,
  );

  return (
    <div className="h-9 flex items-center px-4 gap-3 bg-surface-sidebar border-b border-border flex-shrink-0">
      {/* Agent / session info */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Bot size={13} className="text-brand-500" />
        <span className="text-xs font-medium text-text-primary">
          {activeSessionId ? displayAgent : "No session"}
        </span>
        {currentAgentDescription && (
          <span className="text-[10px] text-text-muted hidden md:inline max-w-[160px] truncate">
            — {currentAgentDescription}
          </span>
        )}
      </div>

      {activeSessionId && (
        <>
          <div className="w-px h-3 bg-border" />

          {/* Context indicator */}
          {activeStoreSession?.metadata?.contextUsagePercent !== undefined && (
            <ContextIndicator
              percent={activeStoreSession.metadata.contextUsagePercent}
              maxTokens={
                activeStoreSession.metadata.maxTokens as number | undefined
              }
            />
          )}

          {/* Model info bar */}
          <ModelInfoBar
            model={activeStoreSession?.model || currentModel || "auto"}
            currentModeId={
              activeStoreSession?.currentModeId || currentMode || "default"
            }
            availableModels={availableModels}
            onModelChange={onModelChange}
          />
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={onOpenConfig}
        className="p-1 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
        title="Settings"
      >
        <SlidersHorizontal size={12} />
      </button>
    </div>
  );
}

export default TopBar;
