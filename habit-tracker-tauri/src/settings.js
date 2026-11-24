const SETTINGS_KEY = "habit-tracker-settings";

export const DEFAULT_SETTINGS = {
  language: "ru",
  weekStart: "monday",
  windowSize: "standard",
};

export const WINDOW_SIZES = {
  compact: { width: 1000, height: 640 },
  standard: { width: 1200, height: 720 },
  wide: { width: 1440, height: 900 },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      language: parsed.language === "en" ? "en" : "ru",
      weekStart: parsed.weekStart === "sunday" ? "sunday" : "monday",
      windowSize: Object.hasOwn(WINDOW_SIZES, parsed.windowSize)
        ? parsed.windowSize
        : "standard",
    };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (_) {
    // Ignore storage errors in restricted environments.
  }
  return next;
}
