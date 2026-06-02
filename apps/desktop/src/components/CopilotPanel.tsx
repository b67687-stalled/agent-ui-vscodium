/**
 * CopilotPanel — Chat panel that uses CopilotKit V2 components.
 *
 * This is the real AG-UI reference UI from CopilotKit, not a hand-rolled clone.
 * Uses CopilotChatMessageView for messages and a custom input bar.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  CopilotChatMessageView,
  CopilotChatInput,
  CopilotChatConfigurationProvider,
} from "@copilotkit/react-core/v2";
import {
  Bot,
  Plus,
  MessageSquare,
  History,
  Search,
  Trash2,
} from "lucide-react";
import { Session } from "../stores/sessionStore";

interface CopilotPanelProps {
  session?: Session;
  activeSessionId: string | null;
  isStreaming: boolean;
  currentAgent: string;
  currentModel?: string;
  onAgentChange: (agent: string) => void;
  onModelChange?: (modelId: string) => void;
  onNewChat: () => void;
  onSendMessage: (text: string) => Promise<void>;
}

export function CopilotPanel({
  session,
  activeSessionId,
  isStreaming,
  currentAgent,
  currentModel,
  onAgentChange,
  onModelChange,
  onNewChat,
  onSendMessage,
}: CopilotPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);

  // Convert session messages to AG-UI format for CopilotChatMessageView
  const aguiMessages = React.useMemo(() => {
    if (!session) return [];
    return session.messages
      .filter((m) => m.role === "user" || m.role === "agent")
      .map((m, idx) => ({
        id: `${session.id}-${idx}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        // For assistant messages, include tool calls if any
        ...(m.role === "agent" && m.toolCall
          ? { toolCalls: [{ ...m.toolCall }] }
          : {}),
      }));
  }, [session]);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [aguiMessages.length, scrollToBottom]);

  // Click outside for history dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        historyRef.current &&
        !historyRef.current.contains(e.target as Node)
      ) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSend = async (text: string) => {
    if (!text.trim() || !activeSessionId || isStreaming) return;
    await onSendMessage(text);
  };

  return (
    <CopilotChatConfigurationProvider
      labels={{
        chatInputPlaceholder: "Type a message...",
        welcomeMessageText: "Start a conversation with your agent",
      }}
    >
      <div data-copilotkit className="dark h-full flex flex-col">
        {/* Header */}
        <div className="h-11 border-b border-border flex items-center px-3 bg-surface-panel flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Bot size={14} className="text-brand-500 flex-shrink-0" />
            <span className="text-sm font-medium text-text-primary truncate">
              {currentAgent || "Agent"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onNewChat}
              className="p-1.5 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              title="New Chat"
            >
              <Plus size={14} />
            </button>
            <div className="relative" ref={historyRef}>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="p-1.5 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
                title="Chat History"
              >
                <History size={14} />
              </button>
              {showHistory && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-surface-elevated border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-1">
                      <Search size={12} className="text-text-muted" />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search..."
                        className="w-full bg-surface-base border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-500/50"
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    <p className="text-xs text-text-muted text-center py-4">
                      Chat history
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages area with CopilotChatMessageView */}
        <div className="flex-1 overflow-y-auto px-3 pt-3">
          {activeSessionId ? (
            aguiMessages.length > 0 ? (
              <CopilotChatMessageView
                messages={aguiMessages}
                isRunning={isStreaming}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-text-muted text-sm">
                Send a message to start
              </div>
            )
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Select or create a session
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Feather gradient */}
        {activeSessionId && (
          <div className="relative z-10 pointer-events-none h-6 -mt-6 feather-gradient" />
        )}

        {/* Input area */}
        <div className="flex-shrink-0 px-3 pb-3 pt-1">
          {activeSessionId ? (
            <CopilotChatInput
              onSubmitMessage={handleSend}
              isRunning={isStreaming}
              placeholder="Type a message..."
            />
          ) : (
            <div className="bg-surface-elevated border border-border rounded-xl px-4 py-3 text-sm text-text-muted text-center">
              Create a session to start chatting
            </div>
          )}
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
}
