/**
 * ContextIndicator — Codex-style context window usage display.
 *
 * Shows a circle that fills based on context usage percentage.
 * Color shifts from green → yellow → red as usage increases.
 */

import React from "react";

interface ContextIndicatorProps {
  percent?: number; // 0-100, undefined = no data
  maxTokens?: number; // Optional: show as "12K / 128K"
}

function getColor(pct: number): string {
  if (pct < 50) return "stroke-emerald-400";
  if (pct < 75) return "stroke-amber-400";
  if (pct < 90) return "stroke-orange-400";
  return "stroke-red-500";
}

function getBgColor(pct: number): string {
  if (pct < 50) return "text-emerald-400";
  if (pct < 75) return "text-amber-400";
  if (pct < 90) return "text-orange-400";
  return "text-red-500";
}

export function ContextIndicator({
  percent,
  maxTokens,
}: ContextIndicatorProps) {
  if (percent === undefined) {
    return (
      <div
        className="flex items-center gap-1.5 text-text-muted"
        title="Context usage unknown"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" className="fill-none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.2"
          />
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="62.83"
            strokeDashoffset="62.83"
            strokeLinecap="round"
            transform="rotate(-90, 12, 12)"
          />
        </svg>
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, percent));
  const circumference = 2 * Math.PI * 10; // r=10
  const offset = circumference - (pct / 100) * circumference;
  const color = getColor(pct);
  const bgColor = getBgColor(pct);
  const displayPct = Math.round(pct);

  return (
    <div
      className="flex items-center gap-1.5 group relative"
      title={`Context: ${displayPct}% used${maxTokens ? ` · ${Math.round((pct * maxTokens) / 100).toLocaleString()} / ${maxTokens.toLocaleString()} tokens` : ""}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-none">
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2"
          className="text-border"
        />
        <circle
          cx="12"
          cy="12"
          r="10"
          strokeWidth="2"
          className={`${color} transition-all duration-500`}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90, 12, 12)"
          style={{
            filter:
              pct > 80
                ? `drop-shadow(0 0 3px ${pct > 90 ? "#ef4444" : "#f97316"})`
                : "none",
          }}
        />
      </svg>
      <span className={`text-[10px] font-mono font-medium ${bgColor}`}>
        {displayPct}%
      </span>

      {/* Tooltip on hover */}
      <div className="absolute top-full mt-1 right-0 bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        <div className="text-[11px] text-text-primary font-medium">
          Context Window
        </div>
        <div className="text-[10px] text-text-secondary">
          {displayPct}% used
        </div>
        {maxTokens && (
          <div className="text-[10px] text-text-muted">
            {Math.round((pct * maxTokens) / 100).toLocaleString()} /{" "}
            {maxTokens.toLocaleString()} tokens
          </div>
        )}
      </div>
    </div>
  );
}

export default ContextIndicator;
