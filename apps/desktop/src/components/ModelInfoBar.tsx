/**
 * ModelInfoBar — Compact model routing visibility display.
 *
 * Shows:
 * - Active model name
 * - Role it's fulfilling (plan / default / smol / commit)
 * - Estimated cost for this session
 */

import React, { useMemo } from "react";
import { Cpu, DollarSign, ChevronDown } from "lucide-react";

// Known model pricing (per 1M input tokens, USD) — approximate
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro": { input: 1.74, output: 3.48 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
  "gpt-5.3-codex": { input: 3.0, output: 15.0 },
  "claude-sonnet-4.6": { input: 3.0, output: 15.0 },
  "claude-opus-4.7": { input: 15.0, output: 75.0 },
  "gemini-3.1-pro": { input: 1.25, output: 5.0 },
};

// Known omp roles
const ROLES = ["default", "smol", "slow", "plan", "commit"] as const;
type Role = (typeof ROLES)[number];

function guessRole(model: string, currentModeId: string): string {
  // If mode matches a known role, use it
  if (ROLES.includes(currentModeId as Role)) return currentModeId;

  // Guess from model name
  if (
    model.includes("flash") ||
    model.includes("mini") ||
    model.includes("nano")
  )
    return "smol";
  if (model.includes("plan")) return "plan";
  return "default";
}

function formatCost(cents: number): string {
  if (cents < 0.01) return "<$0.01";
  return `$${cents.toFixed(2)}`;
}

interface ModelInfoBarProps {
  model: string;
  currentModeId: string;
  availableModels?: Array<{ id: string; name: string }>;
  onModelChange?: (modelId: string) => void;
  sessionCost?: number; // estimated cost in USD for this session
  sessionTokens?: number; // total tokens used this session
}

export function ModelInfoBar({
  model,
  currentModeId,
  availableModels = [],
  onModelChange,
  sessionCost = 0,
  sessionTokens = 0,
}: ModelInfoBarProps) {
  const [showDropdown, setShowDropdown] = React.useState(false);

  const role = guessRole(model, currentModeId);

  const modelPricing = useMemo(() => {
    // Try exact match, then partial
    const exact = MODEL_PRICING[model];
    if (exact) return exact;
    const partial = Object.entries(MODEL_PRICING).find(([key]) =>
      model.includes(key),
    );
    return partial ? partial[1] : null;
  }, [model]);

  const displayName = useMemo(() => {
    const found = availableModels.find((m) => m.id === model);
    return found?.name || model;
  }, [model, availableModels]);

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Model selector */}
      <div className="relative">
        <button
          onClick={() =>
            availableModels.length > 0 && setShowDropdown(!showDropdown)
          }
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ${
            availableModels.length > 0
              ? "hover:bg-surface-hover cursor-pointer"
              : "cursor-default"
          }`}
          title={`Model: ${displayName}`}
        >
          <Cpu size={11} className="text-text-muted" />
          <span className="text-text-secondary font-mono text-[11px] max-w-[100px] truncate">
            {displayName}
          </span>
          {availableModels.length > 0 && (
            <ChevronDown
              size={9}
              className={`text-text-muted transition-transform ${showDropdown ? "rotate-180" : ""}`}
            />
          )}
        </button>

        {showDropdown && availableModels.length > 0 && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-56 bg-surface-elevated border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">
                  Switch Model
                </span>
              </div>
              {availableModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onModelChange?.(m.id);
                    setShowDropdown(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 ${
                    model === m.id
                      ? "bg-brand-500/10 text-brand-500"
                      : "text-text-secondary"
                  }`}
                >
                  <span className="truncate">{m.name}</span>
                  {model === m.id && (
                    <span className="ml-auto text-brand-500">✓</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Role badge */}
      <span
        className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
          role === "default"
            ? "bg-surface-hover text-text-muted"
            : role === "smol"
              ? "bg-emerald-900/50 text-emerald-400"
              : role === "plan"
                ? "bg-purple-900/50 text-purple-400"
                : role === "commit"
                  ? "bg-blue-900/50 text-blue-400"
                  : "bg-surface-hover text-text-muted"
        }`}
      >
        {role}
      </span>

      {/* Estimated cost */}
      {sessionCost > 0 && (
        <span
          className="flex items-center gap-1 text-text-muted"
          title={`~${sessionTokens.toLocaleString()} tokens this session`}
        >
          <DollarSign size={9} />
          <span className="text-[10px] font-mono">
            {formatCost(sessionCost)}
          </span>
        </span>
      )}

      {/* Pricing info in tooltip */}
      {modelPricing && (
        <span
          className="text-[10px] text-text-muted hidden lg:inline"
          title={`Input: $${modelPricing.input}/M · Output: $${modelPricing.output}/M`}
        >
          ${modelPricing.input}/M
        </span>
      )}
    </div>
  );
}

export default ModelInfoBar;
