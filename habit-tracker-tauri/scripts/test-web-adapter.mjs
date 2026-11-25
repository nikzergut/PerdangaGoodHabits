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
  color: "moss",
  anchor: past.anchor,
  days: 14,
});
assert(added.habits.length === 1, "Привычка не добавлена");
assert(added.habits[0].color === "moss", "Цвет не сохранён");
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

threw = false;
try {
  await invoke("add_habit", { name: "Неон", color: "neon" });
} catch (_err) {
  threw = true;
}
assert(threw, "Некорректный цвет должен отвергаться");

const beforeBadAnchor = await invoke("get_board");
threw = false;
try {
  await invoke("add_habit", { name: "Проверка", anchor: "1900-13-45" });
} catch (_err) {
  threw = true;
}
assert(threw, "Некорректный anchor должен отвергаться");
const afterBadAnchor = await invoke("get_board");
assert(
  afterBadAnchor.habits.length === beforeBadAnchor.habits.length,
  "Ошибка anchor не должна сохранять привычку",
);

const renamed = await invoke("rename_habit", {
  id: added.habits[0].id,
  name: "Чтение по утрам",
  anchor: past.anchor,
  days: 14,
});
assert(renamed.habits[0].name === "Чтение по утрам", "Имя не обновлено");
assert(renamed.habits[0].color === "moss", "Переименование не должно сбрасывать цвет");
assert(
  renamed.anchor === past.anchor,
  "Переименование не должно сбрасывать навигацию",
);

const second = await invoke("add_habit", {
  name: "Бег",
  anchor: past.anchor,
  days: 14,
});
const secondId = second.habits.find((h) => h.name === "Бег").id;
assert(second.habits.find((h) => h.id === secondId).color === "indigo", "Цвет по умолчанию должен чередоваться");

const moved = await invoke("move_habit", {
  id: secondId,
  toIndex: 0,
  anchor: past.anchor,
  days: 14,
});
assert(
  JSON.stringify(moved.habits.map((h) => h.name)) ===
    JSON.stringify(["Бег", "Чтение по утрам"]),
  "Порядок привычек не изменился при move_habit",
);

threw = false;
try {
  await invoke("rename_habit", {
    id: added.habits[0].id,
    name: "бег",
    anchor: past.anchor,
    days: 14,
  });
} catch (_err) {
  threw = true;
}
assert(threw, "Дубликат при переименовании должен отвергаться");

const habitId = added.habits[0].id;
const recolored = await invoke("rename_habit", {
  id: habitId,
  name: "Чтение по утрам",
  color: "plum",
  anchor: past.anchor,
  days: 14,
});
const recoloredHabit = recolored.habits.find((h) => h.id === habitId);
assert(recoloredHabit.color === "plum", "Цвет не обновлён при редактировании");

const cleaned = await invoke("delete_habit", {
  id: secondId,
  anchor: past.anchor,
  days: 14,
});
assert(cleaned.habits.length === 1, "Вторая привычка не удалена");

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
assert(
  normalized.habits.every((h, i) => h.color === ["clay", "indigo"][i]),
  "Старые записи должны получать цвета по умолчанию",
);

const exported = await invoke("export_data");
assert(JSON.parse(exported).habits.length === 2, "Экспорт должен содержать привычки");
assert(JSON.parse(exported).nextId === 3, "Экспорт должен содержать nextId");

const imported = await invoke("import_data", {
  json: JSON.stringify({
    version: 1,
    nextId: 2,
    habits: [
      {
        id: 1,
        name: "Чтение",
        createdAt: "2026-01-01",
        completions: ["2026-01-02", "2026-01-03"],
        color: "plum",
      },
    ],
  }),
  anchor: "2026-01-01",
  days: 14,
});
assert(imported.habits.length === 1, "Импорт не заменил данные");
assert(imported.habits[0].color === "plum", "Импорт потерял цвет");
assert(storage.has("habit-tracker-store-backup"), "Импорт должен делать бэкап");

const history = await invoke("get_history");
assert(history.totalCompletions === 2, "История должна считать все отметки");
assert(history.habits[0].completions.length === 2, "История не вернула даты");
assert(history.firstDate === "2026-01-02", "Первая дата истории неверна");
assert(history.lastDate === "2026-01-03", "Последняя дата истории неверна");

threw = false;
try {
  await invoke("import_data", { json: '{"habits":[{"id":1,"name":"","createdAt":"2026-01-01","completions":[]}]}' });
} catch (_err) {
  threw = true;
}
assert(threw, "Импорт с пустым именем должен отвергаться");

threw = false;
try {
  await invoke("import_data", {
    json: '{"version":2,"nextId":2,"habits":[{"id":1,"name":"A","createdAt":"2026-01-01","completions":[],"color":"neon"}]}',
  });
} catch (_err) {
  threw = true;
}
assert(threw, "Импорт с некорректным цветом должен отвергаться");

threw = false;
try {
  await invoke("import_data", {
    json: '{"version":2,"nextId":2,"habits":[{"id":"1","name":"A","createdAt":"2026-01-01","completions":[]}]}',
  });
} catch (_err) {
  threw = true;
}
assert(threw, "Импорт с некорректным id должен отвергаться");

threw = false;
try {
  await invoke("import_data", {
    json: '{"version":2,"nextId":2,"habits":[{"id":1,"name":"A","createdAt":"bad-date","completions":["also-bad"]}]}',
  });
} catch (_err) {
  threw = true;
}
assert(threw, "Импорт с некорректными датами должен отвергаться");

const backupLabel = await invoke("backup_data");
assert(backupLabel === "habit-tracker-store-backup", "Бэкап вернул неверное имя");

await invoke("add_habit", { name: "Вторая", anchor: "2026-01-01", days: 14 });
const deletedForUndo = await invoke("delete_habit", {
  id: 1,
  anchor: "2026-01-01",
  days: 14,
});
assert(deletedForUndo.habits.length === 1, "Привычка не удалена перед undo");
const restored = await invoke("restore_habit", {
  habit: {
    id: 1,
    name: "Чтение",
    createdAt: "2026-01-01",
    completions: ["2026-01-02", "2026-01-03"],
    color: "rose",
  },
  index: 0,
  anchor: "2026-01-01",
  days: 14,
});
assert(restored.habits.length === 2, "Undo не восстановил привычку");
assert(restored.habits[0].name === "Чтение", "Undo не восстановил позицию");
assert(restored.habits[0].completions.length === 2, "Undo потерял историю");
assert(restored.habits[0].color === "rose", "Undo потерял цвет");

threw = false;
try {
  await invoke("set_window_size", { width: 1000, height: 700 });
} catch (_err) {
  threw = true;
}
assert(threw, "Размер окна недоступен в веб-режиме");

const emptyImport = await invoke("import_data", { json: '{"version":2,"nextId":1}' });
assert(emptyImport.habits.length === 0, "Импорт без habits должен очищать хранилище, как на десктопе");

console.log("Web adapter: OK");
