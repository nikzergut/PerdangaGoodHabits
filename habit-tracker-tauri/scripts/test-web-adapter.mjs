import { readFile } from "node:fs/promises";

const storage = new Map();

globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

globalThis.window = {};

const { invoke, isWebMode } = await import("../src/api.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (!isWebMode()) {
  throw new Error("Должен быть выбран веб-режим");
}

const apiSource = await readFile(new URL("../src/api.js", import.meta.url), "utf8");
assert(
  !apiSource.includes("window.__TAURI__"),
  "Нельзя использовать глобальный window.__TAURI__",
);

const config = JSON.parse(
  await readFile(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
assert(
  config.app.withGlobalTauri === false,
  "withGlobalTauri должен быть отключён",
);

const empty = await invoke("get_board");
assert(empty.days.length === 14, "Ожидалось 14 дней в окне");

const past = await invoke("get_board", { anchor: "2020-01-01" });
const added = await invoke("add_habit", {
  name: "Чтение",
  anchor: past.anchor,
  days: 14,
});
assert(added.habits.length === 1, "Привычка не добавлена");
assert(added.anchor === past.anchor, "Добавление не должно сбрасывать навигацию");

let threw = false;
try {
  await invoke("add_habit", { name: "чтение" });
} catch (_err) {
  threw = true;
}
assert(threw, "Дубликат привычки должен отвергаться");

threw = false;
try {
  await invoke("add_habit", { name: "а".repeat(81) });
} catch (_err) {
  threw = true;
}
assert(threw, "Слишком длинное название должно отвергаться");

const toggleArgs = {
  habitId: added.habits[0].id,
  anchor: added.days[0].date,
  days: 14,
};
const date = added.days[7].date;
const toggled = await invoke("toggle_day", { ...toggleArgs, date });
assert(toggled.completed === true, "Первый toggle должен включать отметку");

threw = false;
try {
  await invoke("toggle_day", { ...toggleArgs, date: "1900-01-01" });
} catch (_err) {
  threw = true;
}
assert(threw, "Дата вне текущего окна должна отвергаться");

const visible = await invoke("get_board", { anchor: added.days[0].date, days: 14 });
assert(
  visible.habits[0].completions.includes(date),
  "Отметка должна быть видна в текущем окне",
);

const untoggled = await invoke("toggle_day", { ...toggleArgs, date });
assert(untoggled.completed === false, "Второй toggle должен выключать отметку");

const deleted = await invoke("delete_habit", {
  id: added.habits[0].id,
  anchor: added.days[0].date,
  days: 14,
});
assert(deleted.habits.length === 0, "Привычка не удалена");

storage.set("habit-tracker-store", "{ broken json");
const recovered = await invoke("get_board");
assert(recovered.habits.length === 0, "После битых данных должно быть пустое хранилище");
assert(storage.has("habit-tracker-store-broken"), "Битые данные должны попасть в бэкап");

storage.set(
  "habit-tracker-store",
  JSON.stringify({
    version: 1,
    nextId: 2,
    habits: [
      { id: 1, name: "A", createdAt: "2026-01-01", completions: [] },
      { id: 1, name: "B", createdAt: "2026-01-01", completions: [] },
    ],
  }),
);
const normalized = await invoke("get_board");
assert(
  new Set(normalized.habits.map((h) => h.id)).size === 2,
  "Дубликаты id должны нормализоваться",
);

console.log("Web adapter: OK");
