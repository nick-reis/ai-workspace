import { useCallback, useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

const THEME_STORAGE_KEY = "ai_workspace_theme";
const THEME_EVENT = "ai-workspace-theme-change";

function storedTheme(): AppTheme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
}

export function initializeTheme() {
  if (typeof window === "undefined") return;
  applyTheme(storedTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(() => document.documentElement.classList.contains("dark") ? "dark" : "light");

  useEffect(() => {
    const syncTheme = () => setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
    window.addEventListener("storage", syncTheme);
    window.addEventListener(THEME_EVENT, syncTheme);
    return () => {
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener(THEME_EVENT, syncTheme);
    };
  }, []);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* Theme persistence is best-effort. */ }
    applyTheme(nextTheme);
    setThemeState(nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return { theme, setTheme };
}
