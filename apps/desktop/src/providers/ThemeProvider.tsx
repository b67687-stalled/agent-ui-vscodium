/**
 * ThemeProvider — Auto light/dark with manual toggle.
 *
 * - Reads `prefers-color-scheme` on mount for auto theme
 * - Manual toggle in localStorage overrides auto
 * - Syncs `.dark` class on <html> element
 * - Exposes `theme` and `toggleTheme` via context
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  /** Current resolved theme (light or dark). */
  theme: Theme;
  /** Toggle between light and dark. */
  toggleTheme: () => void;
  /** Force a specific theme, or "auto" for system preference. */
  setTheme: (theme: Theme | "auto") => void;
  /** Whether the user has set a manual preference (vs auto). */
  isManual: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredPreference(): Theme | "auto" | null {
  try {
    const stored = localStorage.getItem("agent-ui-theme");
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // localStorage not available
  }
  return null;
}

function storePreference(theme: Theme | "auto") {
  try {
    if (theme === "auto") {
      localStorage.removeItem("agent-ui-theme");
    } else {
      localStorage.setItem("agent-ui-theme", theme);
    }
  } catch {
    // localStorage not available
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isManual, setIsManual] = useState(() => {
    const stored = getStoredPreference();
    return stored !== null && stored !== "auto";
  });

  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredPreference();
    if (stored && stored !== "auto") return stored;
    return getSystemTheme();
  });

  // Apply theme to DOM
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes (only when auto)
  useEffect(() => {
    if (isManual) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const newTheme = getSystemTheme();
      setThemeState(newTheme);
      applyTheme(newTheme);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [isManual]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      setIsManual(true);
      storePreference(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((next: Theme | "auto") => {
    if (next === "auto") {
      const system = getSystemTheme();
      setIsManual(false);
      storePreference("auto");
      setThemeState(system);
    } else {
      setIsManual(true);
      storePreference(next);
      setThemeState(next);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, isManual }),
    [theme, toggleTheme, setTheme, isManual],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
