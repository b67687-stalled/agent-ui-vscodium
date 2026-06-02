/**
 * CustomChatPanel — Clean coding-agent chat (Codex/AG-UI inspired).
 *
 * Light theme first, auto dark/light via CSS variables.
 * No CopilotKit dependency — pure custom implementation with SSE + Zustand.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  Send,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Terminal,
  FileEdit,
  Globe,
  Sparkles,
  Moon,
  Sun,
} from "lucide-react";
import { Session } from "../stores/sessionStore";
import { useTheme } from "../providers/ThemeProvider";

// ── Types ───────────────────────────────────────────────────────────────────

interface ToolCall {
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "error" | "pending";
  result?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  isThinking?: boolean;
  thinkingDurationMs?: number;
  toolCall?: ToolCall;
  isError?: boolean;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    previewUrl?: string;
  }>;
}

interface CustomChatPanelProps {
  session?: Session;
  activeSessionId: string | null;
  isStreaming: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onNewChat: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const toolIcons: Record<string, React.ReactNode> = {
  bash: <Terminal size={12} />,
  execute_command: <Terminal size={12} />,
  file_edit: <FileEdit size={12} />,
  file_write: <FileEdit size={12} />,
  read: <FileEdit size={12} />,
  web_search: <Globe size={12} />,
  web_fetch: <Globe size={12} />,
};
const defaultToolIcon = <Terminal size={12} />;

function getToolIcon(name: string): React.ReactNode {
  return (
    toolIcons[name] || toolIcons[name.split(".").pop() || ""] || defaultToolIcon
  );
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span>{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
        >
          {copied ? (
            <>
              <Check size={10} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={10} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    toolCall.status === "running"
      ? "text-brand-500"
      : toolCall.status === "completed"
        ? "text-emerald-500"
        : toolCall.status === "error"
          ? "text-red-500"
          : "text-text-muted";

  const statusLabel =
    toolCall.status === "running"
      ? "Running..."
      : toolCall.status === "completed"
        ? "Done"
        : toolCall.status === "error"
          ? "Error"
          : "Pending";

  return (
    <div className="my-2 rounded-lg border border-border bg-surface-tool-call overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left"
      >
        <span className={statusColor}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="flex-shrink-0">{getToolIcon(toolCall.toolName)}</span>
        <span className="font-mono font-medium text-text-primary flex-1">
          {toolCall.toolName}
        </span>
        <span className={`text-[10px] ${statusColor}`}>{statusLabel}</span>
      </button>
      {expanded && toolCall.result && (
        <div className="px-3 pb-2">
          <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
            {toolCall.result}
          </pre>
        </div>
      )}
    </div>
  );
}

function WelcomeScreen({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-surface-elevated border border-border flex items-center justify-center welcome-icon">
          <Bot size={22} className="text-brand-500" />
        </div>
        <h2 className="text-base font-semibold text-text-primary mb-1">
          agent-ui
        </h2>
        <p className="text-sm text-text-secondary mb-5 leading-relaxed">
          Start a conversation with your coding agent. It can read, write, and
          run code in your project.
        </p>
        <button
          onClick={onNewChat}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Sparkles size={14} />
          New Chat
        </button>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      <span className="text-text-muted text-xs">Thinking</span>
      <span className="thinking-dot text-text-muted text-xs">.</span>
      <span className="thinking-dot text-text-muted text-xs">.</span>
      <span className="thinking-dot text-text-muted text-xs">.</span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function CustomChatPanel({
  session,
  activeSessionId,
  isStreaming,
  onSendMessage,
  onNewChat,
}: CustomChatPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { theme, toggleTheme } = useTheme();

  // Convert session messages to our format
  const messages: ChatMessage[] = React.useMemo(() => {
    if (!session) return [];
    return session.messages.map((m, idx) => ({
      id: `${session.id}-${idx}`,
      role: m.role === "user" ? "user" : "agent",
      content: m.content,
      timestamp: m.timestamp || Date.now(),
      isThinking: (m as any).isThinking,
      thinkingDurationMs: (m as any).thinkingDurationMs,
      toolCall: m.toolCall
        ? {
            toolCallId: m.toolCall.toolCallId,
            toolName: m.toolCall.toolName,
            status: (m.toolCall.status as ToolCall["status"]) || "completed",
            result: (m.toolCall as any).result,
          }
        : undefined,
      isError: (m as any).isError,
      attachments: (m as any).attachments,
    }));
  }, [session]);

  // Auto-scroll on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Only auto-scroll if user hasn't scrolled up manually
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        100;
      if (isNearBottom || isStreaming) {
        scrollToBottom();
      }
    } else {
      scrollToBottom();
    }
  }, [messages.length, isStreaming, scrollToBottom]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || !activeSessionId || isStreaming) return;
    setInputValue("");
    await onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [inputValue]);

  // Parse markdown-like content for code blocks
  const renderContent = (content: string) => {
    const parts: React.ReactNode[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Text before code block
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index);
        parts.push(
          <p
            key={`text-${lastIndex}`}
            className="prose-agent whitespace-pre-wrap"
          >
            {text}
          </p>,
        );
      }
      const lang = match[1];
      const code = match[2];
      parts.push(
        <CodeBlock
          key={`code-${match.index}`}
          code={code}
          language={lang || undefined}
        />,
      );
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex);
      parts.push(
        <p
          key={`text-${lastIndex}`}
          className="prose-agent whitespace-pre-wrap"
        >
          {text}
        </p>,
      );
    }

    return parts.length > 0 ? (
      parts
    ) : (
      <p className="prose-agent whitespace-pre-wrap">{content}</p>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="h-11 border-b border-border flex items-center px-3 bg-surface-panel flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Bot size={15} className="text-brand-500 flex-shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate">
            {session?.title || "Agent"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-md hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="New Chat"
          >
            <Sparkles size={14} />
          </button>
        </div>
      </div>

      {/* ── Messages area ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {!activeSessionId ? (
          <WelcomeScreen onNewChat={onNewChat} />
        ) : messages.length === 0 && !isStreaming ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-text-muted">Send a message to start</p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className="animate-fade-in-up">
                {msg.role === "user" ? (
                  /* ── User message ─────────────────────────────── */
                  <div className="flex justify-end">
                    <div className="max-w-[75%] bg-surface-chat-user text-surface-chat-user-text rounded-2xl rounded-br-lg px-4 py-2.5">
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </p>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-2">
                          {msg.attachments.map((att) => (
                            <span
                              key={att.id}
                              className="text-[11px] bg-white/10 rounded px-2 py-0.5"
                            >
                              {att.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-white/40 text-right mt-1">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Agent message ────────────────────────────── */
                  <div className="flex justify-start">
                    <div className="max-w-[85%] min-w-0">
                      {/* Agent label */}
                      <div className="flex items-center gap-1.5 mb-1">
                        <Bot size={12} className="text-brand-500" />
                        <span className="text-[11px] font-medium text-text-secondary">
                          Agent
                        </span>
                      </div>

                      {/* Thinking indicator */}
                      {msg.isThinking && (
                        <div className="flex items-center gap-1.5 mb-1">
                          <ThinkingIndicator />
                          {msg.thinkingDurationMs && (
                            <span className="text-[10px] text-text-muted">
                              {formatDuration(msg.thinkingDurationMs)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Content */}
                      {msg.content && (
                        <div
                          className={
                            msg.isError
                              ? "text-red-500 text-sm"
                              : "text-sm text-text-primary"
                          }
                        >
                          {renderContent(msg.content)}
                        </div>
                      )}

                      {/* Tool call */}
                      {msg.toolCall && (
                        <ToolCallBlock toolCall={msg.toolCall} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Streaming cursor */}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 px-1">
                  <div className="flex items-center gap-1">
                    <Bot size={12} className="text-brand-500" />
                    <span className="text-[11px] font-medium text-text-secondary mr-1">
                      Agent
                    </span>
                  </div>
                  <span className="stream-cursor" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Feather gradient ──────────────────────────────────────── */}
      {activeSessionId && (
        <div className="relative z-10 pointer-events-none h-8 -mt-8 feather-gradient" />
      )}

      {/* ── Input area ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-4 pt-1">
        {activeSessionId ? (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-surface-panel border border-border rounded-xl px-3 py-2 focus-within:border-brand-500/50 transition-colors">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted resize-none outline-none py-1 max-h-40 leading-relaxed"
                disabled={isStreaming}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isStreaming}
                className="flex-shrink-0 p-1.5 rounded-lg bg-brand-500 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
            {isStreaming && (
              <p className="text-[10px] text-text-muted text-center mt-1">
                Agent is working...
              </p>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            <div className="bg-surface-panel border border-border rounded-xl px-4 py-3 text-sm text-text-muted text-center">
              Create a session to start chatting
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
