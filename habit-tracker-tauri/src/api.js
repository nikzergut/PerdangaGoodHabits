const STORAGE_KEY = "habit-tracker-store";
const BROKEN_KEY = "habit-tracker-store-broken";
const SCHEMA_VERSION = 1;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function isWebMode() {
  return !Boolean(window.__TAURI__?.core?.invoke);
}

function isTauri() {
  return !isWebMode();
}

function defaultStore() {
  return {
    version: SCHEMA_VERSION,
    nextId: 1,
    habits: [],
  };
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
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : todayISO(),
    completions: Array.isArray(raw.completions)
      ? raw.completions.filter((date) => typeof date === "string")
      : [],
  };
}

function normalizeStore(raw) {
  const version = Number.isInteger(raw?.version) ? raw.version : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Версия формата ${version} новее поддерживаемой ${SCHEMA_VERSION}`,
    );
  }

  const habits = Array.isArray(raw?.habits)
    ? raw.habits.map(normalizeHabit).filter(Boolean)
    : [];
  const maxId = habits.reduce((max, habit) => Math.max(max, habit.id), 0);
  let nextId = Number.isInteger(raw?.nextId) ? raw.nextId : 1;
  if (nextId <= maxId) nextId = maxId + 1;
  if (nextId < 1) nextId = 1;

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
      completions: habit.completions.filter((date) => visible.has(date)),
    })),
  };
}

async function webInvoke(command, args = {}) {
  switch (command) {
    case "get_board": {
      const anchor = resolveAnchor(args.anchor);
      return boardFromStore(loadStore(), anchor, args.days ?? DEFAULT_DAYS);
    }

    case "add_habit": {
      const name = String(args.name ?? "").trim();
      if (!name) {
        throw new Error("Название привычки не может быть пустым");
      }

      const store = loadStore();
      if (store.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Привычка "${name}" уже существует`);
      }

      store.habits.push({
        id: store.nextId,
        name,
        createdAt: todayISO(),
        completions: [],
      });
      store.nextId += 1;
      saveStore(store);

      return boardFromStore(store, addDays(todayISO(), -Math.floor(DEFAULT_DAYS / 2)), DEFAULT_DAYS);
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

    case "toggle_day": {
      const date = parseDate(String(args.date ?? "").trim());
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
    return window.__TAURI__.core.invoke(command, args);
  }
  return webInvoke(command, args);
}
