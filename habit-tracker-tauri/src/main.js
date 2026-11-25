import { HABIT_COLORS, invoke, isWebMode } from "./api.js";
import {
  applyTranslations,
  getLocale,
  localizeError,
  setLocale,
  t,
} from "./i18n.js";
import { loadSettings, saveSettings, WINDOW_SIZES } from "./settings.js";

const DAYS_PER_PAGE = 14;
const HALF_RANGE = Math.floor(DAYS_PER_PAGE / 2);
const THEME_KEY = "habit-tracker-theme";
const UNDO_TIMEOUT_MS = 15000;

const state = {
  anchor: null,
  days: [],
  habits: [],
  busy: false,
  theme: "light",
  pendingToggles: new Set(),
  generation: 0,
  editingId: null,
  editingColor: null,
  colorId: null,
  search: "",
  undo: null,
  undoTimer: null,
  history: null,
  settings: loadSettings(),
};

const daysRow = document.querySelector("#days-row");
const boardBody = document.querySelector("#board-body");
const emptyState = document.querySelector("#empty-state");
const statusEl = document.querySelector("#status");
const addForm = document.querySelector("#add-form");
const habitNameInput = document.querySelector("#habit-name");
const habitColorOptions = document.querySelector("#habit-color-options");
const rangeNote = document.querySelector("#range-note");
const datePicker = document.querySelector("#date-picker");
const calendarBtn = document.querySelector("#calendar-btn");
const themeToggle = document.querySelector("#theme-toggle");
const langToggle = document.querySelector("#lang-toggle");
const habitSearch = document.querySelector("#habit-search");
const clearSearchBtn = document.querySelector("#clear-search");
const undoBar = document.querySelector("#undo-bar");
const undoText = document.querySelector("#undo-text");
const undoBtn = document.querySelector("#undo-btn");

const historyDialog = document.querySelector("#history-dialog");
const statsDialog = document.querySelector("#stats-dialog");
const dataDialog = document.querySelector("#data-dialog");
const settingsDialog = document.querySelector("#settings-dialog");
const historySummary = document.querySelector("#history-summary");
const historyContent = document.querySelector("#history-content");
const statsContent = document.querySelector("#stats-content");
const dataText = document.querySelector("#data-text");
const dataFile = document.querySelector("#data-file");
const dataStatus = document.querySelector("#data-status");
const dataFormat = document.querySelector("#data-format");
const settingLanguage = document.querySelector("#setting-language");
const settingWeekStart = document.querySelector("#setting-week-start");
const settingWindowSize = document.querySelector("#setting-window-size");
const settingsWebNote = document.querySelector("#settings-web-note");

let dialogOpener = null;

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

function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

function defaultAnchor() {
  let anchor = addDays(todayISO(), -HALF_RANGE);
  const firstDay = state.settings.weekStart === "sunday" ? 0 : 1;
  const weekday = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  return addDays(anchor, -((weekday - firstDay + 7) % 7));
}

function formatWeekday(dateISO) {
  const dt = new Date(`${dateISO}T00:00:00Z`);
  const localeTag = getLocale() === "ru" ? "ru-RU" : "en-US";
  const label = new Intl.DateTimeFormat(localeTag, {
    weekday: "short",
    timeZone: "UTC",
  }).format(dt);
  const clean = label.replace(".", "");
  return clean.charAt(0).toLocaleUpperCase() + clean.slice(1);
}

function formatDateLong(dateISO) {
  if (!dateISO) return "—";
  return `${dateISO.slice(8, 10)}.${dateISO.slice(5, 7)}.${dateISO.slice(0, 4)}`;
}

function formatMonth(yearMonth) {
  const localeTag = getLocale() === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(localeTag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00Z`));
}

function weekdayOrder() {
  const monday = "2026-01-05";
  const names = Array.from({ length: 7 }, (_unused, i) =>
    formatWeekday(addDays(monday, i)),
  );
  return state.settings.weekStart === "sunday"
    ? [names[6], ...names.slice(0, 6)]
    : names;
}

function setStatus(message = "", isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setDialogStatus(message = "", isError = false) {
  if (!dataStatus) return;
  dataStatus.textContent = message;
  dataStatus.classList.toggle("error", isError);
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
    const label = next === "dark" ? t("themeDarkAria") : t("themeLightAria");
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
    themeToggle.querySelector(".theme-toggle-icon").textContent = next === "dark" ? "☀" : "◐";
    themeToggle.querySelector(".theme-toggle-text").textContent =
      next === "dark" ? t("themeDarkText") : t("themeLightText");
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

function syncLanguageToggle() {
  if (!langToggle) return;
  const next = state.settings.language === "en" ? "ru" : "en";
  langToggle.textContent = next.toUpperCase();
  const label = t(next === "en" ? "langSwitchToEn" : "langSwitchToRu");
  langToggle.setAttribute("aria-label", label);
  langToggle.title = label;
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
    rangeNote.textContent = t("rangeDefault");
    return;
  }
  const first = state.days[0];
  const last = state.days[state.days.length - 1];
  rangeNote.textContent = t("rangeNote", { first: first.label, last: last.label });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function colorKey(habit) {
  return HABIT_COLORS.includes(habit?.color) ? habit.color : HABIT_COLORS[0];
}

function nextColorKey() {
  return HABIT_COLORS[state.habits.length % HABIT_COLORS.length];
}

function selectedComposerColor() {
  const checked = habitColorOptions?.querySelector("input:checked");
  return checked?.value || nextColorKey();
}

function renderComposerColors(selected = selectedComposerColor()) {
  if (!habitColorOptions) return;
  const current = HABIT_COLORS.includes(selected) ? selected : nextColorKey();
  habitColorOptions.innerHTML = "";

  HABIT_COLORS.forEach((key, index) => {
    const label = document.createElement("label");
    label.className = "color-swatch";
    label.dataset.color = key;
    label.title = t(`color.${key}`);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "habit-color";
    input.value = key;
    input.checked = key === current;
    input.setAttribute("aria-label", t(`color.${key}`));

    const box = document.createElement("span");
    box.className = "color-swatch-box";
    box.setAttribute("aria-hidden", "true");
    box.textContent = String(index + 1);

    label.append(input, box);
    habitColorOptions.appendChild(label);
  });
}

function syncComposerColorSelection() {
  if (!habitColorOptions || habitColorOptions.querySelector("input:checked")) return;
  const target = habitColorOptions.querySelector(`input[value="${nextColorKey()}"]`);
  if (target) target.checked = true;
}

function buildColorPalette(selected) {
  const palette = document.createElement("div");
  palette.className = "color-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", t("editColorAria"));

  HABIT_COLORS.forEach((key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch-btn";
    button.dataset.color = key;
    button.textContent = String(HABIT_COLORS.indexOf(key) + 1);
    button.title = t(`color.${key}`);
    button.setAttribute("aria-label", t(`color.${key}`));
    button.setAttribute("aria-pressed", String(key === selected));
    palette.appendChild(button);
  });

  return palette;
}

function clearUndo() {
  if (state.undoTimer !== null) {
    clearTimeout(state.undoTimer);
    state.undoTimer = null;
  }
  state.undo = null;
  renderUndoBar();
}

function renderUndoBar() {
  if (!undoBar) return;
  const visible = Boolean(state.undo);
  undoBar.classList.toggle("hidden", !visible);
  if (visible) {
    undoText.textContent = t("undoDeleted", { name: state.undo.habit.name });
  }
}

function showUndo(habit, index) {
  clearUndo();
  state.undo = { habit, index };
  renderUndoBar();
  state.undoTimer = setTimeout(() => {
    clearUndo();
  }, UNDO_TIMEOUT_MS);
}

function applyBoard(board, options = {}) {
  state.generation += 1;
  state.anchor = board.anchor;
  state.days = board.days;
  state.habits = board.habits;
  state.pendingToggles.clear();
  state.editingId = null;
  state.editingColor = null;
  state.colorId = null;
  state.history = null;
  if (!options.keepUndo) clearUndo();
  syncComposerColorSelection();
  renderBoard();
  if (historyDialog.open) void loadHistory();
  if (statsDialog.open) renderStats();
}

async function loadBoard(anchor = state.anchor || defaultAnchor(), options = {}) {
  if (state.pendingToggles.size > 0) return;
  setBusy(true);
  setStatus(t("statusLoading"));
  try {
    const board = await invoke("get_board", { anchor, days: DAYS_PER_PAGE });
    applyBoard(board, options);
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
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
      <div class="head-cell head-cell--habit" data-i18n="habitColumn">${escapeHtml(t("habitColumn"))}</div>
    </th>
  `;

  for (const day of state.days) {
    const th = document.createElement("th");
    th.className = day.isToday ? "is-today" : "";
    th.innerHTML = `
      <div class="day-head ${day.isToday ? "is-today" : ""}">
        <div class="day-weekday">${escapeHtml(formatWeekday(day.date))}</div>
        <div class="day-date">${escapeHtml(day.label)}</div>
      </div>
    `;
    daysRow.appendChild(th);
  }
}

function renderBody() {
  boardBody.innerHTML = "";

  const query = state.search.trim().toLocaleLowerCase();
  const habits = query
    ? state.habits.filter((h) => h.name.toLocaleLowerCase().includes(query))
    : state.habits;

  if (!habits.length && state.habits.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = state.days.length + 1;
    cell.className = "no-matches";
    cell.textContent = t("noMatches");
    row.appendChild(cell);
    boardBody.appendChild(row);
    return;
  }

  for (const habit of habits) {
    const tr = document.createElement("tr");
    tr.dataset.habitId = habit.id;

    const nameTd = document.createElement("td");
    nameTd.className = "habit-col sticky-col";
    const editing = state.editingId === habit.id;
    const index = habits.indexOf(habit);
    nameTd.innerHTML = `
      <div class="habit-cell" data-color="${colorKey(habit)}"${editing ? ' data-editing="true"' : ""}>
        <span class="habit-name-wrap">
          <button
            class="habit-color-mark"
            type="button"
            data-id="${habit.id}"
            aria-label="${escapeHtml(t("pickColorAria", { name: habit.name }))}"
            title="${escapeHtml(t("pickColorAria", { name: habit.name }))}"
          ></button>
          <span class="habit-name" title="${escapeHtml(habit.name)}">${escapeHtml(habit.name)}</span>
        </span>
        <div class="habit-actions" aria-label="${escapeHtml(t("habitActionsAria", { name: habit.name }))}">
          <button
            class="drag-handle"
            type="button"
            data-id="${habit.id}"
            draggable="true"
            aria-label="${escapeHtml(t("dragAria", { name: habit.name }))}"
            title="${escapeHtml(t("dragTitle"))}"
          >⋮⋮</button>
          <button
            class="edit-btn"
            type="button"
            data-id="${habit.id}"
            aria-label="${escapeHtml(t("editAria", { name: habit.name }))}"
            title="${escapeHtml(t("renameTitle"))}"
          >✎</button>
          <button
            class="delete-btn"
            type="button"
            data-id="${habit.id}"
            aria-label="${escapeHtml(t("deleteAria", { name: habit.name }))}"
            title="${escapeHtml(t("deleteTitle"))}"
          >×</button>
        </div>
      </div>
    `;
    if (!editing && state.colorId === habit.id) {
      nameTd.querySelector(".habit-cell").appendChild(buildColorPalette(colorKey(habit)));
    }
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
            aria-label="${escapeHtml(habit.name)}, ${escapeHtml(formatWeekday(day.date))} ${escapeHtml(day.label)}"
            ${checked}
          />
        </label>
      `;
      tr.appendChild(td);
    }

    boardBody.appendChild(tr);
  }
}

async function onAddHabit(event) {
  event.preventDefault();
  if (isBusy()) return;
  const name = habitNameInput.value.trim();
  if (!name) {
    setStatus(t("errors.emptyName"), true);
    return;
  }

  setBusy(true);
  setStatus(t("statusSaving"));
  try {
    const board = await invoke("add_habit", {
      name,
      color: selectedComposerColor(),
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    applyBoard(board);
    habitNameInput.value = "";
    renderComposerColors(nextColorKey());
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
    habitNameInput.focus();
  }
}

function startRename(id) {
  if (isBusy() || state.editingId !== null) return;
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return;

  const row = boardBody.querySelector(`tr[data-habit-id="${id}"]`);
  const cell = row?.querySelector(".habit-cell");
  if (!cell) return;

  const nameEl = cell.querySelector(".habit-name");
  const editBtn = cell.querySelector(".edit-btn");
  const deleteBtn = cell.querySelector(".delete-btn");
  if (!nameEl || !editBtn || !deleteBtn) return;

  state.editingId = id;
  state.editingColor = colorKey(habit);
  state.colorId = null;
  const input = document.createElement("input");
  input.className = "rename-input";
  input.type = "text";
  input.value = habit.name;
  input.maxLength = 80;
  input.setAttribute("aria-label", t("renameInputAria"));
  nameEl.replaceWith(input);

  const saveBtn = document.createElement("button");
  saveBtn.className = "edit-btn save-rename-btn";
  saveBtn.type = "button";
  saveBtn.dataset.id = id;
  saveBtn.textContent = "✓";
  saveBtn.setAttribute("aria-label", t("saveRenameAria"));
  saveBtn.title = t("saveRenameTitle");
  editBtn.replaceWith(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "delete-btn cancel-rename-btn";
  cancelBtn.type = "button";
  cancelBtn.setAttribute("aria-label", t("cancelRenameAria"));
  cancelBtn.title = t("cancelRenameTitle");
  cancelBtn.textContent = "×";
  deleteBtn.replaceWith(cancelBtn);

  cell.appendChild(buildColorPalette(state.editingColor));

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveRename(id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  });
  input.focus();
  input.select();
  setStatus("");
}

async function saveRename(id) {
  if (state.editingId !== id || isBusy()) return;
  const input = boardBody.querySelector(`tr[data-habit-id="${id}"] .rename-input`);
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    setStatus(t("errors.emptyName"), true);
    input.focus();
    return;
  }

  setBusy(true);
  setStatus(t("statusSaving"));
  try {
    const board = await invoke("rename_habit", {
      id,
      name,
      color: state.editingColor,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    state.editingId = null;
    applyBoard(board);
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
    if (state.editingId === id) input.focus();
  }
}

function closeColorPicker() {
  if (state.colorId === null) return;
  const id = state.colorId;
  state.colorId = null;
  renderBody();
  boardBody.querySelector(`.habit-color-mark[data-id="${id}"]`)?.focus();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.colorId !== null && state.editingId === null) {
    event.preventDefault();
    closeColorPicker();
  }
});

async function applyHabitColor(id, name, color) {
  setBusy(true);
  setStatus(t("statusSaving"));
  try {
    const board = await invoke("rename_habit", {
      id,
      name,
      color,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    state.colorId = null;
    applyBoard(board);
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
    boardBody.querySelector(`.habit-color-mark[data-id="${id}"]`)?.focus();
  }
}

function cancelRename() {
  if (state.editingId === null) return;
  const id = state.editingId;
  state.editingId = null;
  state.editingColor = null;
  renderBody();
  setStatus("");
  boardBody.querySelector(`tr[data-habit-id="${id}"] .edit-btn`)?.focus();
}

function openDialog(dialog) {
  if (dialog.open) return;
  dialogOpener = document.activeElement;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

async function onBoardClick(event) {
  const colorMark = event.target.closest(".habit-color-mark");
  if (colorMark) {
    if (isBusy() || state.editingId !== null) return;
    const id = Number(colorMark.dataset.id);
    state.colorId = state.colorId === id ? null : id;
    renderBody();
    const target = state.colorId === null
      ? boardBody.querySelector(`.habit-color-mark[data-id="${id}"]`)
      : boardBody.querySelector(`tr[data-habit-id="${id}"] .color-swatch-btn`);
    target?.focus();
    return;
  }

  const colorBtn = event.target.closest(".color-swatch-btn");
  if (colorBtn && state.colorId !== null && state.editingId === null) {
    const id = state.colorId;
    const habit = state.habits.find((h) => h.id === id);
    if (!habit || isBusy()) return;
    const color = colorBtn.dataset.color;
    if (color === colorKey(habit)) {
      closeColorPicker();
    } else {
      void applyHabitColor(id, habit.name, color);
    }
    return;
  }

  if (colorBtn && state.editingId !== null) {
    state.editingColor = colorBtn.dataset.color;
    for (const button of colorBtn.parentElement.querySelectorAll(".color-swatch-btn")) {
      button.setAttribute("aria-pressed", String(button === colorBtn));
    }
    return;
  }

  const saveBtn = event.target.closest(".save-rename-btn");
  if (saveBtn) {
    void saveRename(Number(saveBtn.dataset.id));
    return;
  }

  if (event.target.closest(".cancel-rename-btn")) {
    cancelRename();
    return;
  }



  const editBtn = event.target.closest(".edit-btn");
  if (editBtn) {
    startRename(Number(editBtn.dataset.id));
    return;
  }

  const deleteBtn = event.target.closest(".delete-btn");
  if (!deleteBtn || isBusy()) return;

  const id = Number(deleteBtn.dataset.id);
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return;
  if (!window.confirm(t("confirmDelete", { name: habit.name }))) return;

  setBusy(true);
  setStatus(t("statusDeleting"));
  try {
    const index = state.habits.findIndex((h) => h.id === id);
    const history = await invoke("get_history");
    const full = history.habits.find((h) => h.id === id) ?? habit;
    const board = await invoke("delete_habit", {
      id,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    applyBoard(board, { keepUndo: true });
    showUndo(full, index);
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
  }
}

async function onUndoClick() {
  if (!state.undo || isBusy()) return;
  const { habit, index } = state.undo;
  setBusy(true);
  setStatus(t("statusRestoring"));
  try {
    const board = await invoke("restore_habit", {
      habit,
      index,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    clearUndo();
    applyBoard(board);
    setStatus("");
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
  }
}

let draggedHabitId = null;

function clearDropTarget() {
  boardBody
    .querySelectorAll("tr.drag-over")
    .forEach((row) => row.classList.remove("drag-over"));
}

async function moveHabit(id, toIndex) {
  setBusy(true);
  setStatus("");
  try {
    const board = await invoke("move_habit", {
      id,
      toIndex,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    applyBoard(board, { keepUndo: true });
  } catch (err) {
    setStatus(localizeError(err), true);
  } finally {
    setBusy(false);
  }
}

function liveCheckbox(habitId, date) {
  return boardBody.querySelector(
    `.day-check[data-habit-id="${habitId}"][data-date="${date}"]`,
  );
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
    const result = await invoke("toggle_day", {
      habitId,
      date,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    if (generation !== state.generation) return;
    if (result.completed !== nextChecked) {
      const current = liveCheckbox(habitId, date);
      if (current) current.checked = result.completed;
      updateLocalCompletion(habitId, date, result.completed);
    }
  } catch (err) {
    if (generation !== state.generation) return;
    const current = liveCheckbox(habitId, date);
    if (current) current.checked = previous;
    updateLocalCompletion(habitId, date, previous);
    setStatus(localizeError(err), true);
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

async function loadHistory() {
  try {
    const history = await invoke("get_history");
    state.history = history;
    renderHistory();
  } catch (err) {
    setStatus(localizeError(err), true);
  }
}

function monthDays(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
}

function renderHistory() {
  const history = state.history;
  if (!history) return;

  if (!history.totalCompletions) {
    historySummary.textContent = "";
    historyContent.innerHTML = `<p class="panel-empty">${escapeHtml(t("historyEmpty"))}</p>`;
    return;
  }

  historySummary.textContent = t("historySummary", {
    count: history.totalCompletions,
    first: formatDateLong(history.firstDate),
    last: formatDateLong(history.lastDate),
  });

  const months = new Map();
  for (const habit of history.habits) {
    for (const date of habit.completions) {
      const month = date.slice(0, 7);
      if (!months.has(month)) months.set(month, new Map());
      const days = months.get(month);
      if (!days.has(date)) days.set(date, new Set());
      days.get(date).add(habit.id);
    }
  }

  const habits = history.habits;
  const html = [...months.keys()]
    .sort()
    .reverse()
    .map((month) => {
      const days = months.get(month);
      const allDays = monthDays(month);
      const header = habits
        .map(
          (h) =>
            `<th scope="col"><span class="color-dot" data-color="${colorKey(h)}" aria-hidden="true"></span>${escapeHtml(h.name)}</th>`,
        )
        .join("");

      const rows = [...days.keys()]
        .sort()
        .reverse()
        .map((date) => {
          const done = days.get(date);
          const cells = habits
            .map((h) =>
              done.has(h.id)
                ? `<td class="is-done" aria-label="${escapeHtml(t("statsCompleted"))}">✓</td>`
                : '<td class="is-empty" aria-hidden="true">—</td>',
            )
            .join("");
          const weekday = formatWeekday(date);
          return `<tr><th scope="row" class="history-date">${escapeHtml(formatDateLong(date))} · ${escapeHtml(weekday)}</th>${cells}</tr>`;
        })
        .join("");

      const heatHead = allDays
        .map((date) => `<th scope="col" class="heat-col">${escapeHtml(date.slice(8, 10))}</th>`)
        .join("");
      const heatRows = habits
        .map((h) => {
          const set = new Set(h.completions);
          const cells = allDays
            .map((date) => {
              const done = set.has(date);
              const label = `${h.name}, ${formatDateLong(date)}: ${
                done ? t("statsCompleted") : "—"
              }`;
              return `<td class="heat-cell ${done ? "is-done" : "is-empty"}" data-color="${colorKey(h)}" aria-label="${escapeHtml(label)}">${done ? "■" : ""}</td>`;
            })
            .join("");
          return `<tr><th scope="row" class="heat-habit"><span class="color-dot" data-color="${colorKey(h)}" aria-hidden="true"></span>${escapeHtml(h.name)}</th>${cells}</tr>`;
        })
        .join("");

      return `
        <section class="history-month">
          <h3>${escapeHtml(formatMonth(month))}</h3>
          <div class="heatmap-wrap">
            <table class="history-table heatmap-table">
              <thead><tr><th scope="col" class="heat-habit">${escapeHtml(t("statsHabit"))}</th>${heatHead}</tr></thead>
              <tbody>${heatRows}</tbody>
            </table>
          </div>
          <table class="history-table">
            <thead><tr><th scope="col" class="history-date">${escapeHtml(t("historyDayColumn"))}</th>${header}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  historyContent.innerHTML = html;
}

function bestStreak(dates) {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const date of sorted) {
    run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

function currentStreak(dates) {
  const set = new Set(dates);
  const today = todayISO();
  let cursor = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function computeStats(history) {
  const today = todayISO();
  const allDates = history.habits.flatMap((h) => h.completions);
  const starts = history.habits
    .map((h) => h.createdAt)
    .filter((date) => Boolean(date));
  const periodStart = [today, ...starts, ...allDates].sort()[0];
  const dayCount = Math.max(1, daysBetween(periodStart, today) + 1);
  const total = history.totalCompletions;
  const percent = history.habits.length
    ? Math.round((total / (history.habits.length * dayCount)) * 100)
    : 0;

  const perHabit = history.habits.map((habit) => ({
    name: habit.name,
    color: colorKey(habit),
    count: habit.completions.length,
    percent: Math.round((habit.completions.length / dayCount) * 100),
    current: currentStreak(habit.completions),
    best: bestStreak(habit.completions),
  }));

  const byDate = new Map();
  const byWeekday = new Map();
  for (const date of allDates) {
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
    const weekday = formatWeekday(date);
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + 1);
  }
  const bestDays = [...byDate.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
    .slice(0, 3);
  const orderedWeekdays = weekdayOrder();
  const bestWeekday = orderedWeekdays
    .map((name) => ({ name, count: byWeekday.get(name) ?? 0 }))
    .sort((a, b) => b.count - a.count)[0];

  return {
    dayCount,
    total,
    percent,
    perHabit,
    bestDays,
    bestWeekday,
    currentStreak: Math.max(0, ...perHabit.map((h) => h.current)),
    bestStreak: Math.max(0, ...perHabit.map((h) => h.best)),
    periodStart,
    periodEnd: today,
  };
}

function renderStats() {
  const history = state.history;
  if (!history || !history.habits.length) {
    statsContent.innerHTML = `<p class="panel-empty">${escapeHtml(t("statsNoData"))}</p>`;
    return;
  }

  const stats = computeStats(history);
  const metrics = [
    [t("statsTotal"), String(stats.total)],
    [t("statsCurrentStreak"), t("statsDaysWord", { count: stats.currentStreak })],
    [t("statsBestStreak"), t("statsDaysWord", { count: stats.bestStreak })],
    [
      t("statsBestWeekday"),
      stats.bestWeekday?.count
        ? `${stats.bestWeekday.name} · ${stats.bestWeekday.count}`
        : "—",
    ],
  ];
  const metricHtml = metrics
    .map(
      ([label, value]) => `
        <div class="stats-metric">
          <p class="stats-metric-label">${escapeHtml(label)}</p>
          <span class="stats-metric-value">${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join("");

  const rows = stats.perHabit
    .map(
      (habit) => `
        <tr>
          <td><span class="color-dot" data-color="${habit.color}" aria-hidden="true"></span>${escapeHtml(habit.name)}</td>
          <td>${habit.count}</td>
          <td>${habit.percent}%</td>
          <td>${habit.current}</td>
          <td>${habit.best}</td>
        </tr>
      `,
    )
    .join("");

  const bestDays = stats.bestDays.length
    ? stats.bestDays
        .map(([date, count]) => `${formatDateLong(date)} · ${count}`)
        .join(" · ")
    : "—";

  statsContent.innerHTML = `
    <div class="stats-overview">
      <div class="stats-hero">
        <p class="stats-hero-label">${escapeHtml(t("statsOverall"))}</p>
        <p class="stats-hero-value">${stats.percent}%</p>
        <p class="stats-hero-note">${escapeHtml(t("statsPeriod"))}: ${escapeHtml(formatDateLong(stats.periodStart))} — ${escapeHtml(formatDateLong(stats.periodEnd))} · ${stats.dayCount}</p>
      </div>
      <div class="stats-metrics">${metricHtml}</div>
    </div>
    <h3 class="panel-section-title">${escapeHtml(t("statsPerHabit"))}</h3>
    <div class="panel-table-wrap">
      <table class="history-table stats-table">
        <thead>
          <tr>
            <th scope="col">${escapeHtml(t("statsHabit"))}</th>
            <th scope="col">${escapeHtml(t("statsCompleted"))}</th>
            <th scope="col">${escapeHtml(t("statsPercent"))}</th>
            <th scope="col">${escapeHtml(t("statsCurrentStreak"))}</th>
            <th scope="col">${escapeHtml(t("statsBestStreak"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="stats-footer">${escapeHtml(t("statsBestDay"))}: ${escapeHtml(bestDays)}</p>
  `;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatData(store, format) {
  if (format === "json") return JSON.stringify(store, null, 2);
  if (format === "csv") {
    const lines = ["id,name,color,createdAt,completionsCount,completions"];
    for (const habit of store.habits) {
      const completions = [...(habit.completions || [])].sort();
      lines.push(
        [
          habit.id,
          habit.name,
          habit.color,
          habit.createdAt,
          completions.length,
          completions.join("|"),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    return lines.join("\n");
  }

  const lines = ["# PerdangaGoodHabits", ""];
  for (const habit of store.habits) {
    const completions = [...(habit.completions || [])].sort();
    lines.push(`## ${habit.name}`);
    lines.push("");
    lines.push(`- id: ${habit.id}`);
    lines.push(`- color: ${habit.color}`);
    lines.push(`- createdAt: ${habit.createdAt}`);
    lines.push(`- completions: ${completions.length}`);
    if (completions.length) {
      for (const date of completions) lines.push(`  - ${date}`);
    } else {
      lines.push("  - _none_");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function buildExportText(format = dataFormat?.value || "json") {
  const json = await invoke("export_data");
  if (format === "json") return json;
  return formatData(JSON.parse(json), format);
}

async function openDataPanel() {
  setDialogStatus("");
  openDialog(dataDialog);
  try {
    dataText.value = await buildExportText();
    setDialogStatus(t("dataExported"));
  } catch (err) {
    setDialogStatus(localizeError(err), true);
  }
}

async function copyData() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(dataText.value);
    } else {
      dataText.focus();
      dataText.select();
      if (!document.execCommand("copy")) throw new Error("execCommand");
    }
    setDialogStatus(t("dataCopied"));
  } catch (err) {
    setDialogStatus(t("errors.copy", { error: err }), true);
  }
}

function downloadData() {
  const format = dataFormat?.value || "json";
  const mime =
    format === "csv"
      ? "text/csv;charset=utf-8"
      : format === "md"
        ? "text/markdown;charset=utf-8"
        : "application/json";
  const blob = new Blob([dataText.value], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = t(`dataDownloadName.${format}`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleBackup() {
  setDialogStatus("");
  try {
    const label = await invoke("backup_data");
    setDialogStatus(t("dataBackedUp", { name: label }));
  } catch (err) {
    setDialogStatus(localizeError(err), true);
  }
}

async function handleImport() {
  if (isBusy()) return;
  if (!window.confirm(t("dataConfirmImport"))) return;

  let json = dataText.value.trim();
  const file = dataFile.files?.[0];
  if (file) json = await file.text();
  if (!json) {
    setDialogStatus(t("errors.importParse"), true);
    return;
  }

  setBusy(true);
  setStatus(t("statusImporting"));
  try {
    const board = await invoke("import_data", {
      json,
      anchor: state.anchor,
      days: DAYS_PER_PAGE,
    });
    applyBoard(board);
    closeDialog(dataDialog);
    dataText.value = "";
    dataFile.value = "";
    setStatus(t("dataImported"));
  } catch (err) {
    setDialogStatus(localizeError(err), true);
  } finally {
    setBusy(false);
  }
}

function syncSettingsForm() {
  settingLanguage.value = state.settings.language;
  settingWeekStart.value = state.settings.weekStart;
  settingWindowSize.value = state.settings.windowSize;
  const web = isWebMode();
  settingWindowSize.disabled = web;
  settingsWebNote.classList.toggle("hidden", !web);
}

function refreshLocaleUI() {
  setLocale(state.settings.language);
  applyTranslations();
  renderComposerColors();
  syncLanguageToggle();
  applyTheme(state.theme, false);
  syncSettingsForm();
  state.editingId = null;
  state.editingColor = null;
  state.colorId = null;
  renderBoard();
  renderUndoBar();
  if (historyDialog.open) {
    if (state.history) renderHistory();
    else void loadHistory();
  }
  if (statsDialog.open) renderStats();
}

function applyLanguage(language) {
  const next = language === "en" ? "en" : "ru";
  if (state.settings.language === next) return;
  state.settings = saveSettings({ language: next });
  refreshLocaleUI();
}

async function saveSettingsFromDialog() {
  const next = saveSettings({
    language: settingLanguage.value === "en" ? "en" : "ru",
    weekStart: settingWeekStart.value === "sunday" ? "sunday" : "monday",
    windowSize: Object.hasOwn(WINDOW_SIZES, settingWindowSize.value)
      ? settingWindowSize.value
      : "standard",
  });
  state.settings = next;
  refreshLocaleUI();
  closeDialog(settingsDialog);
  setStatus(t("settingsSaved"));

  if (!isWebMode()) {
    try {
      await invoke("set_window_size", WINDOW_SIZES[next.windowSize]);
    } catch (err) {
      setStatus(localizeError(err), true);
    }
  }
}

async function applySavedWindowSize() {
  if (isWebMode()) return;
  try {
    await invoke("set_window_size", WINDOW_SIZES[state.settings.windowSize]);
  } catch (err) {
    setStatus(localizeError(err), true);
  }
}

function handleSearch(event) {
  state.search = event.target.value;
  state.editingId = null;
  state.editingColor = null;
  state.colorId = null;
  renderBody();
}

function clearSearch() {
  state.search = "";
  habitSearch.value = "";
  state.editingId = null;
  state.editingColor = null;
  state.colorId = null;
  renderBody();
  habitSearch.focus();
}

window.addEventListener("DOMContentLoaded", () => {
  applyTranslations();
  renderComposerColors();
  initTheme();
  if (isWebMode()) {
    document.querySelector("#mode-badge")?.classList.remove("hidden");
  }
  syncSettingsForm();
  syncLanguageToggle();
  void applySavedWindowSize();

  addForm.addEventListener("submit", onAddHabit);
  boardBody.addEventListener("click", onBoardClick);
  boardBody.addEventListener("change", onBoardChange);

  boardBody.addEventListener("dragstart", (event) => {
    const handle = event.target.closest(".drag-handle");
    if (!handle || isBusy() || state.editingId !== null) {
      event.preventDefault();
      return;
    }
    draggedHabitId = Number(handle.dataset.id);
    const row = handle.closest("tr[data-habit-id]");
    row?.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", String(draggedHabitId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });

  boardBody.addEventListener("dragover", (event) => {
    if (draggedHabitId === null) return;
    const row = event.target.closest("tr[data-habit-id]");
    if (!row) return;
    event.preventDefault();
    clearDropTarget();
    row.classList.add("drag-over");
  });

  boardBody.addEventListener("drop", (event) => {
    if (draggedHabitId === null) return;
    const row = event.target.closest("tr[data-habit-id]");
    if (!row) return;
    event.preventDefault();
    const targetId = Number(row.dataset.habitId);
    clearDropTarget();
    const from = state.habits.findIndex((h) => h.id === draggedHabitId);
    const to = state.habits.findIndex((h) => h.id === targetId);
    draggedHabitId = null;
    boardBody
      .querySelectorAll("tr.is-dragging")
      .forEach((r) => r.classList.remove("is-dragging"));
    if (from === -1 || to === -1 || from === to) return;
    void moveHabit(state.habits[from].id, to);
  });

  boardBody.addEventListener("dragend", () => {
    draggedHabitId = null;
    clearDropTarget();
    boardBody
      .querySelectorAll("tr.is-dragging")
      .forEach((row) => row.classList.remove("is-dragging"));
  });
  undoBtn.addEventListener("click", onUndoClick);

  habitSearch.addEventListener("input", handleSearch);
  clearSearchBtn.addEventListener("click", clearSearch);

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
  langToggle.addEventListener("click", () => {
    applyLanguage(state.settings.language === "en" ? "ru" : "en");
  });

  document.querySelector("#history-btn").addEventListener("click", () => {
    openDialog(historyDialog);
    void loadHistory();
  });
  document.querySelector("#stats-btn").addEventListener("click", () => {
    openDialog(statsDialog);
    void loadHistory().then(renderStats);
  });
  document.querySelector("#data-btn").addEventListener("click", () => {
    void openDataPanel();
  });
  document.querySelector("#settings-btn").addEventListener("click", () => {
    syncSettingsForm();
    openDialog(settingsDialog);
  });

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      if (dialogOpener?.isConnected && !dialogOpener.disabled) {
        dialogOpener.focus();
      }
      dialogOpener = null;
    });
    for (const button of dialog.querySelectorAll("[data-close-dialog]")) {
      button.addEventListener("click", () => closeDialog(dialog));
    }
  }

  dataFormat?.addEventListener("change", () => {
    void openDataPanel();
  });
  document.querySelector("#data-export").addEventListener("click", () => {
    void openDataPanel();
  });
  document.querySelector("#data-copy").addEventListener("click", () => {
    void copyData();
  });
  document.querySelector("#data-download").addEventListener("click", downloadData);
  document.querySelector("#data-backup").addEventListener("click", () => {
    void handleBackup();
  });
  document.querySelector("#data-import").addEventListener("click", () => {
    void handleImport();
  });
  document.querySelector("#settings-save").addEventListener("click", () => {
    void saveSettingsFromDialog();
  });

  loadBoard(defaultAnchor());
});
