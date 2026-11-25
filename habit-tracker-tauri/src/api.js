import { invoke as tauriInvoke } from "./vendor/tauri/core.js";

const STORAGE_KEY = "habit-tracker-store";
const BROKEN_KEY = "habit-tracker-store-broken";
const SCHEMA_VERSION = 2;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MAX_NAME_LEN = 80;

export const HABIT_COLORS = [
  "clay",
  "indigo",
  "moss",
  "teal",
  "plum",
  "gold",
  "slate",
  "rose",
];

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__?.invoke);
}

export function isWebMode() {
  return !isTauri();
}

function defaultStore() {
  return {
    version: SCHEMA_VERSION,
    nextId: 1,
    habits: [],
  };
}

function isColor(value) {
  return HABIT_COLORS.includes(value);
}

function colorForIndex(index) {
  return HABIT_COLORS[index % HABIT_COLORS.length];
}

function validateColor(value, allowEmpty = false) {
  const color = typeof value === "string" ? value.trim() : "";
  if ((allowEmpty && !color) || isColor(color)) return;
  throw new Error("Некорректный цвет привычки");
}

function resolveColorArg(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const color = String(value).trim();
  if (!color) return fallback;
  validateColor(color);
  return color;
}

function validDateOrNull(value) {
  try {
    return parseDate(String(value ?? "").trim());
  } catch (_) {
    return null;
  }
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Некорректная дата: ${value}`);
  }

  const [y, m, d] = value.split("-").map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR) {
    throw new Error(`Дата должна быть в диапазоне ${MIN_YEAR}-${MAX_YEAR}: ${value}`);
  }

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Некорректная дата: ${value}`);
  }

  return value;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayShort(dateISO) {
  const dt = new Date(`${dateISO}T00:00:00Z`);
  return WEEKDAYS[dt.getUTCDay()];
}

function normalizeHabit(raw) {
  if (!raw || !Number.isInteger(raw.id) || typeof raw.name !== "string") {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    completions: Array.isArray(raw.completions)
      ? raw.completions.filter((date) => typeof date === "string")
      : [],
    color: typeof raw.color === "string" ? raw.color : "",
  };
}

function normalizeStore(raw) {
  const version = Number.isInteger(raw?.version) ? raw.version : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Версия формата ${version} новее поддерживаемой ${SCHEMA_VERSION}`,
    );
  }

  const used = new Set();
  let candidate = Number.isInteger(raw?.nextId) ? raw.nextId : 1;
  if (candidate < 1) candidate = 1;

  const habits = (Array.isArray(raw?.habits)
    ? raw.habits.map(normalizeHabit).filter(Boolean)
    : []
  ).map((habit, index) => {
    if (habit.id < 1 || used.has(habit.id)) {
      while (used.has(candidate)) candidate += 1;
      habit.id = candidate;
      candidate += 1;
    }
    used.add(habit.id);

    const color = String(habit.color).trim();
    habit.color = isColor(color) ? color : colorForIndex(index);
    habit.createdAt = validDateOrNull(habit.createdAt) || todayISO();
    habit.completions = [...new Set(
      habit.completions
        .map((date) => String(date).trim())
        .filter((date) => validDateOrNull(date)),
    )].sort();
    return habit;
  });

  const maxId = used.size ? Math.max(...used) : 0;
  const nextId = Math.max(candidate, maxId + 1, 1);

  return {
    version: SCHEMA_VERSION,
    nextId,
    habits,
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !raw.trim()) return defaultStore();
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    console.warn("Не удалось загрузить данные из localStorage:", err);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(BROKEN_KEY, raw);
    } catch (_) {
      // Ignore storage errors.
    }
    return defaultStore();
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function resolveAnchor(anchor) {
  if (anchor && String(anchor).trim()) {
    return parseDate(String(anchor).trim());
  }
  return addDays(todayISO(), -Math.floor(DEFAULT_DAYS / 2));
}

function buildDays(anchor, days) {
  const count = Math.min(Math.max(days ?? DEFAULT_DAYS, 1), MAX_DAYS);
  const today = todayISO();
  const result = [];

  for (let offset = 0; offset < count; offset += 1) {
    const date = parseDate(addDays(anchor, offset));
    result.push({
      date,
      label: `${date.slice(8, 10)}.${date.slice(5, 7)}`,
      weekday: weekdayShort(date),
      isToday: date === today,
    });
  }

  return result;
}

function boardFromStore(store, anchor, days) {
  const daysVec = buildDays(anchor, days);
  const visible = new Set(daysVec.map((day) => day.date));

  return {
    anchor,
    days: daysVec,
    habits: store.habits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      createdAt: habit.createdAt,
      color: isColor(habit.color) ? habit.color : HABIT_COLORS[0],
      completions: habit.completions.filter((date) => visible.has(date)),
    })),
  };
}

function historyFromStore(store) {
  const habits = store.habits
    .map((habit) => ({
      id: habit.id,
      name: habit.name,
      createdAt: habit.createdAt,
      color: isColor(habit.color) ? habit.color : HABIT_COLORS[0],
      completions: [...new Set(habit.completions)].sort(),
    }));
  const allDates = [...new Set(habits.flatMap((h) => h.completions))].sort();

  return {
    habits,
    totalCompletions: habits.reduce((sum, h) => sum + h.completions.length, 0),
    firstDate: allDates[0] ?? null,
    lastDate: allDates[allDates.length - 1] ?? null,
  };
}

function validateStoreData(store) {
  const names = new Set();
  for (const habit of store.habits) {
    const name = String(habit.name ?? "").trim();
    validateName(name);
    validateColor(habit.color, true);
    const lowered = name.toLowerCase();
    if (names.has(lowered)) {
      throw new Error(`Привычка "${name}" уже существует`);
    }
    names.add(lowered);
    parseDate(String(habit.createdAt ?? "").trim());
    for (const date of habit.completions) {
      parseDate(String(date).trim());
    }
  }
}

function validateImportShape(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw.habits !== undefined && !Array.isArray(raw.habits))
  ) {
    throw new Error("Не удалось разобрать импортируемые данные");
  }
  const habits = raw.habits ?? [];
  for (const habit of habits) {
    if (
      !habit ||
      typeof habit !== "object" ||
      !Number.isInteger(habit.id) ||
      typeof habit.name !== "string" ||
      typeof habit.createdAt !== "string" ||
      !Array.isArray(habit.completions) ||
      habit.completions.some((date) => typeof date !== "string") ||
      (habit.color !== undefined && typeof habit.color !== "string")
    ) {
      throw new Error("Не удалось разобрать импортируемые данные");
    }
    validateColor(habit.color, true);
    parseDate(habit.createdAt.trim());
    for (const date of habit.completions) {
      parseDate(date.trim());
    }
  }
}

function validateName(name) {
  if (!name) {
    throw new Error("Название привычки не может быть пустым");
  }
  if ([...name].length > MAX_NAME_LEN) {
    throw new Error(
      `Название привычки не может быть длиннее ${MAX_NAME_LEN} символов`,
    );
  }
}

async function webInvoke(command, args = {}) {
  switch (command) {
    case "get_board": {
      const anchor = resolveAnchor(args.anchor);
      return boardFromStore(loadStore(), anchor, args.days ?? DEFAULT_DAYS);
    }

    case "get_history": {
      return historyFromStore(loadStore());
    }

    case "export_data": {
      return JSON.stringify(loadStore(), null, 2);
    }

    case "import_data": {
      const anchor = resolveAnchor(args.anchor);
      const raw = JSON.parse(String(args.json ?? "").trim());
      validateImportShape(raw);
      const parsed = normalizeStore(raw);
      validateStoreData(parsed);
      const store = normalizeStore(parsed);
      try {
        localStorage.setItem("habit-tracker-store-backup", localStorage.getItem(STORAGE_KEY) ?? "");
      } catch (_) {
        // Backup is best effort in restricted environments.
      }
      saveStore(store);
      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "backup_data": {
      const raw = localStorage.getItem(STORAGE_KEY) ?? "";
      try {
        localStorage.setItem("habit-tracker-store-backup", raw);
      } catch (_) {
        // Ignore storage errors.
      }
      return "habit-tracker-store-backup";
    }

    case "restore_habit": {
      const anchor = resolveAnchor(args.anchor);
      const store = loadStore();
      const raw = args.habit ?? {};
      const name = String(raw.name ?? "").trim();
      validateName(name);
      validateColor(raw.color, true);
      const completions = [...new Set((raw.completions ?? []).map((d) => parseDate(String(d).trim())))].sort();

      if (store.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Привычка "${name}" уже существует`);
      }

      let id = Number(raw.id);
      if (!Number.isInteger(id) || id < 1 || store.habits.some((h) => h.id === id)) {
        id = store.nextId;
      }
      const index = Number.isInteger(args.index) ? Math.max(0, Math.min(args.index, store.habits.length)) : store.habits.length;
      store.habits.splice(index, 0, {
        id,
        name,
        createdAt: parseDate(String(raw.createdAt ?? todayISO()).trim()),
        completions,
        color: resolveColorArg(raw.color, colorForIndex(store.habits.length)),
      });
      store.nextId = Math.max(store.nextId, id + 1);
      saveStore(store);

      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "set_window_size": {
      throw new Error("Размер окна доступен только в десктопной версии");
    }

    case "add_habit": {
      const anchor = resolveAnchor(args.anchor);
      const name = String(args.name ?? "").trim();
      validateName(name);

      const store = loadStore();
      if (store.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Привычка "${name}" уже существует`);
      }
      const color = resolveColorArg(args.color, colorForIndex(store.habits.length));

      store.habits.push({
        id: store.nextId,
        name,
        createdAt: todayISO(),
        completions: [],
        color,
      });
      store.nextId += 1;
      saveStore(store);

      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "rename_habit": {
      const anchor = resolveAnchor(args.anchor);
      const id = Number(args.id);
      const name = String(args.name ?? "").trim();
      validateName(name);

      const store = loadStore();
      const habit = store.habits.find((h) => h.id === id);
      if (!habit) {
        throw new Error(`Привычка с id ${id} не найдена`);
      }
      if (
        store.habits.some(
          (h) =>
            h.id !== id && h.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error(`Привычка "${name}" уже существует`);
      }

      habit.name = name;
      habit.color = resolveColorArg(args.color, habit.color);
      saveStore(store);

      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "delete_habit": {
      const anchor = resolveAnchor(args.anchor);
      const id = Number(args.id);
      const store = loadStore();
      const before = store.habits.length;
      store.habits = store.habits.filter((habit) => habit.id !== id);
      if (store.habits.length === before) {
        throw new Error(`Привычка с id ${id} не найдена`);
      }
      saveStore(store);

      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "move_habit": {
      const anchor = resolveAnchor(args.anchor);
      const id = Number(args.id);
      const toIndex = Number(args.toIndex);
      const store = loadStore();
      const from = store.habits.findIndex((habit) => habit.id === id);
      if (from === -1) throw new Error(`Привычка с id ${id} не найдена`);
      if (!Number.isInteger(toIndex)) {
        throw new Error("Некорректная позиция привычки");
      }
      const [habit] = store.habits.splice(from, 1);
      const to = Math.max(0, Math.min(toIndex, store.habits.length));
      store.habits.splice(to, 0, habit);
      saveStore(store);
      return boardFromStore(store, anchor, args.days ?? DEFAULT_DAYS);
    }

    case "toggle_day": {
      const date = parseDate(String(args.date ?? "").trim());
      const anchor = resolveAnchor(args.anchor);
      const visible = new Set(
        buildDays(anchor, args.days ?? DEFAULT_DAYS).map((day) => day.date),
      );
      if (!visible.has(date)) {
        throw new Error(`Дата вне текущего окна: ${date}`);
      }

      const id = Number(args.habitId);
      const store = loadStore();
      const habit = store.habits.find((h) => h.id === id);
      if (!habit) {
        throw new Error(`Привычка с id ${id} не найдена`);
      }

      let completed;
      const pos = habit.completions.indexOf(date);
      if (pos !== -1) {
        habit.completions.splice(pos, 1);
        completed = false;
      } else {
        habit.completions.push(date);
        habit.completions.sort();
        habit.completions = [...new Set(habit.completions)];
        completed = true;
      }
      saveStore(store);

      return { habitId: habit.id, date, completed };
    }

    default:
      throw new Error(`Неизвестная команда: ${command}`);
  }
}

export async function invoke(command, args) {
  if (isTauri()) {
    return tauriInvoke(command, args);
  }
  return webInvoke(command, args);
}
