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

const empty = await invoke("get_board");
assert(empty.days.length === 14, "Ожидалось 14 дней в окне");

const added = await invoke("add_habit", { name: "Чтение" });
assert(added.habits.length === 1, "Привычка не добавлена");

let threw = false;
try {
  await invoke("add_habit", { name: "чтение" });
} catch (_err) {
  threw = true;
}
assert(threw, "Дубликат привычки должен отвергаться");

const date = added.days[7].date;
const toggled = await invoke("toggle_day", { habitId: added.habits[0].id, date });
assert(toggled.completed === true, "Первый toggle должен включать отметку");

const visible = await invoke("get_board", { anchor: added.days[0].date, days: 14 });
assert(
  visible.habits[0].completions.includes(date),
  "Отметка должна быть видна в текущем окне",
);

const untoggled = await invoke("toggle_day", { habitId: added.habits[0].id, date });
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

console.log("Web adapter: OK");
