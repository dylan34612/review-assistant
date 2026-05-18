"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle dark mode">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}
