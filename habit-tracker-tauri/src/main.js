import { invoke, isWebMode } from "./api.js";

const DAYS_PER_PAGE = 14;
const HALF_RANGE = Math.floor(DAYS_PER_PAGE / 2);
const THEME_KEY = "habit-tracker-theme";

const state = {
  anchor: null,
  days: [],
  habits: [],
  busy: false,
  theme: "light",
  pendingToggles: new Set(),
  generation: 0,
};

const daysRow = document.querySelector("#days-row");
const boardBody = document.querySelector("#board-body");
const emptyState = document.querySelector("#empty-state");
const statusEl = document.querySelector("#status");
const addForm = document.querySelector("#add-form");
const habitNameInput = document.querySelector("#habit-name");
const rangeNote = document.querySelector("#range-note");
const datePicker = document.querySelector("#date-picker");
const calendarBtn = document.querySelector("#calendar-btn");
const themeToggle = document.querySelector("#theme-toggle");

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function defaultAnchor() {
  return addDays(todayISO(), -HALF_RANGE);
}

function setStatus(message = "", isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function isBusy() {
  return state.busy || state.pendingToggles.size > 0;
}

function syncControls() {
  const busy = isBusy();
  document.querySelectorAll("button, input").forEach((el) => {
    if (el.dataset.noBusy === "true") return;
    if (el.classList.contains("day-check")) return;
    el.disabled = busy;
  });
  syncToggleDisabled();
}

function setBusy(busy) {
  state.busy = busy;
  syncControls();
}

function toggleKey(habitId, date) {
  return `${habitId}:${date}`;
}

function syncToggleDisabled() {
  document.querySelectorAll(".day-check").forEach((el) => {
    const key = toggleKey(el.dataset.habitId, el.dataset.date);
    el.disabled = state.busy || state.pendingToggles.has(key);
  });
}

function applyTheme(theme, persist = true) {
  const next = theme === "dark" ? "dark" : "light";
  state.theme = next;
  document.documentElement.dataset.theme = next;
  if (themeToggle) {
    const label = next === "dark" ? "Светлая тема" : "Тёмная тема";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
    themeToggle.querySelector(".theme-toggle-icon").textContent = next === "dark" ? "☀" : "◐";
    themeToggle.querySelector(".theme-toggle-text").textContent = next === "dark" ? "Свет" : "Тьма";
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {
      // Ignore storage errors in restricted environments.
    }
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (_) {
    saved = null;
  }
  if (saved === "dark" || saved === "light") {
    applyTheme(saved, false);
    return;
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light", false);
}

function anchorForDate(dateISO) {
  return addDays(dateISO, -HALF_RANGE);
}

function syncDatePicker() {
  if (!datePicker) return;
  const center = state.anchor ? addDays(state.anchor, HALF_RANGE) : todayISO();
  datePicker.value = center;
}

function updateRangeNote() {
  if (!state.days.length) {
    rangeNote.textContent = "14 дней в окне";
    return;
  }
  const first = state.days[0];
  const last = state.days[state.days.length - 1];
  rangeNote.textContent = `${first.label} — ${last.label}`;
}

function applyBoard(board) {
  state.generation += 1;
  state.anchor = board.anchor;
  state.days = board.days;
  state.habits = board.habits;
  state.pendingToggles.clear();
  renderBoard();
}

async function loadBoard(anchor = state.anchor || defaultAnchor()) {
  if (state.pendingToggles.size > 0) return;
  setBusy(true);
  setStatus("Загружаю...");
  try {
    const board = await invoke("get_board", { anchor, days: DAYS_PER_PAGE });
    applyBoard(board);
    setStatus("");
  } catch (err) {
    setStatus(String(err), true);
  } finally {
    setBusy(false);
  }
}

function renderBoard() {
  renderHead();
  renderBody();
  updateRangeNote();
  syncDatePicker();
  syncControls();
  emptyState.classList.toggle("hidden", state.habits.length !== 0);
}

function renderHead() {
  daysRow.innerHTML = `
    <th class="habit-col sticky-col">
      <div class="head-cell head-cell--habit">Привычка</div>
    </th>
  `;

  for (const day of state.days) {
    const th = document.createElement("th");
    th.className = day.isToday ? "is-today" : "";
    th.innerHTML = `
      <div class="day-head ${day.isToday ? "is-today" : ""}">
        <div class="day-weekday">${escapeHtml(day.weekday)}</div>
        <div class="day-date">${escapeHtml(day.label)}</div>
      </div>
    `;
    daysRow.appendChild(th);
  }
}

function renderBody() {
  boardBody.innerHTML = "";

  for (const habit of state.habits) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "habit-col sticky-col";
    nameTd.innerHTML = `
      <div class="habit-cell">
        <span class="habit-name" title="${escapeHtml(habit.name)}">${escapeHtml(habit.name)}</span>
        <button
          class="delete-btn"
          type="button"
          data-id="${habit.id}"
          aria-label="Удалить привычку ${escapeHtml(habit.name)}"
          title="Удалить"
        >×</button>
      </div>
    `;
    tr.appendChild(nameTd);

    const completionSet = new Set(habit.completions);
    for (const day of state.days) {
      const td = document.createElement("td");
      td.className = `check-cell ${day.isToday ? "is-today" : ""}`;
      const checked = completionSet.has(day.date) ? "checked" : "";
      td.innerHTML = `
        <label class="check-wrap">
          <input
            class="day-check"
            type="checkbox"
            data-habit-id="${habit.id}"
            data-date="${day.date}"
            aria-label="${escapeHtml(habit.name)}, ${escapeHtml(day.label)}"
            ${checked}
          />
        </label>
      `;
      tr.appendChild(td);
    }

    boardBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function onAddHabit(event) {
  event.preventDefault();
  if (isBusy()) return;
  const name = habitNameInput.value.trim();
  if (!name) {
    setStatus("Введите название привычки.", true);
    return;
  }

  setBusy(true);
  setStatus("Сохраняю...");
  try {
    const board = await invoke("add_habit", {
      name,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    applyBoard(board);
    habitNameInput.value = "";
    setStatus("");
  } catch (err) {
    setStatus(String(err), true);
  } finally {
    setBusy(false);
    habitNameInput.focus();
  }
}

async function onBoardClick(event) {
  const deleteBtn = event.target.closest(".delete-btn");
  if (!deleteBtn || isBusy()) return;

  const id = Number(deleteBtn.dataset.id);
  const habit = state.habits.find((h) => h.id === id);
  const label = habit ? `«${habit.name}»` : "эту привычку";
  if (!window.confirm(`Удалить ${label}? История отметок тоже будет удалена.`)) return;

  setBusy(true);
  setStatus("Удаляю...");
  try {
    const board = await invoke("delete_habit", { id, anchor: state.anchor, days: DAYS_PER_PAGE });
    applyBoard(board);
    setStatus("");
  } catch (err) {
    setStatus(String(err), true);
  } finally {
    setBusy(false);
  }
}

function updateLocalCompletion(habitId, date, completed) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;
  const idx = habit.completions.indexOf(date);
  if (completed && idx === -1) {
    habit.completions.push(date);
    habit.completions.sort();
  } else if (!completed && idx !== -1) {
    habit.completions.splice(idx, 1);
  }
}

async function onBoardChange(event) {
  const checkbox = event.target.closest(".day-check");
  if (!checkbox) return;

  const habitId = Number(checkbox.dataset.habitId);
  const date = checkbox.dataset.date;
  const key = toggleKey(habitId, date);
  if (state.pendingToggles.has(key)) return;

  const generation = state.generation;
  const nextChecked = checkbox.checked;
  const previous = !nextChecked;
  updateLocalCompletion(habitId, date, nextChecked);

  state.pendingToggles.add(key);
  syncControls();
  setStatus("");

  try {
    const result = await invoke("toggle_day", { habitId, date });
    if (generation !== state.generation) return;
    if (result.completed !== nextChecked) {
      checkbox.checked = result.completed;
      updateLocalCompletion(habitId, date, result.completed);
    }
  } catch (err) {
    if (generation !== state.generation) return;
    checkbox.checked = previous;
    updateLocalCompletion(habitId, date, previous);
    setStatus(String(err), true);
  } finally {
    state.pendingToggles.delete(key);
    syncControls();
  }
}

function shiftRange(days) {
  if (isBusy()) return;
  const base = state.anchor || defaultAnchor();
  loadBoard(addDays(base, days));
}

function openDatePicker() {
  if (isBusy()) return;
  try {
    if (typeof datePicker.showPicker === "function") {
      datePicker.showPicker();
      return;
    }
  } catch (_err) {
    // Показываем фокус на обёртке и передаём управление самому input.
  }
  datePicker.focus();
}

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  if (isWebMode()) {
    document.querySelector("#mode-badge")?.classList.remove("hidden");
  }
  addForm.addEventListener("submit", onAddHabit);
  boardBody.addEventListener("click", onBoardClick);
  boardBody.addEventListener("change", onBoardChange);

  document.querySelector("#prev-range").addEventListener("click", () => shiftRange(-7));
  document.querySelector("#next-range").addEventListener("click", () => shiftRange(7));
  document.querySelector("#today-range").addEventListener("click", () => {
    if (isBusy()) return;
    loadBoard(defaultAnchor());
  });
  calendarBtn.addEventListener("click", openDatePicker);
  datePicker.addEventListener("change", (event) => {
    const value = event.target.value;
    if (!value || isBusy()) return;
    loadBoard(anchorForDate(value));
  });
  themeToggle.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  loadBoard(defaultAnchor());
});