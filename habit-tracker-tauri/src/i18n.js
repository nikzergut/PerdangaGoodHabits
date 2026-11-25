import { loadSettings } from "./settings.js";

const DICTS = {
  ru: {
    kicker: "дневник дисциплины",
    webBadge: "веб",
    title: "Привычки",
    habitColumn: "Привычка",
    navAria: "Навигация по датам",
    navPrev: "Назад",
    navToday: "Сегодня",
    navNext: "Вперёд",
    calendarAria: "Открыть календарь",
    calendarTitle: "Выбрать дату",
    dateAria: "Выбрать дату",
    rangeDefault: "14 дней в окне",
    rangeNote: "{first} — {last}",
    searchLabel: "Поиск привычек",
    searchPlaceholder: "найти по названию...",
    clearSearch: "Очистить поиск",
    historyBtn: "История",
    statsBtn: "Статистика",
    dataBtn: "Данные",
    settingsBtn: "Настройки",
    composerAria: "Добавить привычку",
    composerLabel: "Новая привычка",
    composerPlaceholder: "читать, бегать, писать...",
    colorLabel: "Цвет",
    colorHint: "Цвет можно изменить при редактировании.",
    "color.clay": "глина",
    "color.indigo": "индиго",
    "color.moss": "мох",
    "color.teal": "бирюза",
    "color.plum": "слива",
    "color.gold": "охра",
    "color.slate": "сланец",
    "color.rose": "роза",
    addBtn: "Добавить",
    statusLoading: "Загружаю...",
    statusSaving: "Сохраняю...",
    statusDeleting: "Удаляю...",
    statusRestoring: "Восстанавливаю...",
    statusImporting: "Импортирую...",
    statusBackingUp: "Создаю бэкап...",
    emptyTitle: "Пока пусто",
    emptyCopy: "Добавь привычку выше. Таблица заполнится днями и чекбоксами.",
    noMatches: "Привычки по этому запросу не найдены.",
    toolbarAria: "Работа с привычками",
    boardAria: "Таблица привычек",
    editAria: "Редактировать привычку {name}",
    editColorAria: "Цвет привычки",
    pickColorAria: "Выбрать цвет привычки {name}",
    habitActionsAria: "Действия с привычкой {name}",
    dragAria: "Перетащить привычку {name}",
    dragTitle: "Перетащить",
    renameAria: "Переименовать привычку {name}",
    renameTitle: "Переименовать",
    saveRenameAria: "Сохранить название",
    saveRenameTitle: "Сохранить",
    cancelRenameAria: "Отменить переименование",
    cancelRenameTitle: "Отмена",
    renameInputAria: "Новое название привычки",
    deleteAria: "Удалить привычку {name}",
    deleteTitle: "Удалить",
    deleteDialogTitle: "Удаление привычки",
    confirmDelete: "Удалить «{name}»? История отметок тоже будет удалена.",
    deleteConfirm: "Удалить",
    deleteCancel: "Отмена",
    themeDarkAria: "Светлая тема",
    themeLightAria: "Тёмная тема",
    themeDarkText: "Свет",
    themeLightText: "Тьма",
    quickControls: "Быстрые переключатели",
    langSwitchToEn: "Переключить на английский",
    langSwitchToRu: "Переключить на русский",
    undoDeleted: "Удалено: {name}",
    undoAction: "Отменить",
    undoRestoring: "Восстанавливаю...",
    historyTitle: "Полная история",
    closeAria: "Закрыть",
    closeTitle: "Закрыть",
    historySummary: "Отметок: {count} · Период: {first} — {last}",
    historyEmpty: "Отметок пока нет. Отмечай дни в таблице — они появятся здесь.",
    historyDayColumn: "День",
    statsTitle: "Статистика",
    statsOverall: "Общее выполнение",
    statsPeriod: "Учитываемый период",
    statsTotal: "Всего отметок",
    statsPerHabit: "По привычкам",
    statsHabit: "Привычка",
    statsCompleted: "Отметок",
    statsPercent: "Выполнение",
    statsCurrentStreak: "Текущая серия",
    statsBestStreak: "Лучшая серия",
    statsBestDay: "Лучший день",
    statsBestWeekday: "Лучший день недели",
    statsDaysWord: "{count} дн.",
    statsNoData: "Пока нет данных для статистики.",
    dataTitle: "Данные",
    dataSectionExport: "Экспорт",
    dataSectionImport: "Импорт",
    dataFormatLabel: "Формат",
    dataTextLabel: "Данные",
    dataExport: "Экспорт",
    dataCopy: "Копировать",
    dataDownload: "Скачать",
    dataBackup: "Бэкап",
    dataFileLabel: "Загрузить файл JSON",
    dataImport: "Импорт (заменить данные)",
    dataImportNote: "Импорт поддерживает только JSON. CSV/Markdown — только для экспорта.",
    dataExported: "Данные загружены в поле. Можно скопировать или скачать.",
    dataCopied: "Данные скопированы в буфер обмена.",
    dataImported: "Данные импортированы.",
    dataBackedUp: "Бэкап создан: {name}",
    dataConfirmImport: "Заменить текущие данные данными из поля/файла? Текущие данные будут сохранены в бэкап.",
    "dataDownloadName.json": "habits.json",
    "dataDownloadName.csv": "habits.csv",
    "dataDownloadName.md": "habits.md",
    settingsTitle: "Настройки",
    settingsLanguage: "Язык",
    settingsWeekStart: "Первый день недели",
    settingsWindowSize: "Размер окна",
    settingsSave: "Сохранить",
    settingsCancel: "Отмена",
    langRu: "Русский",
    langEn: "English",
    weekMonday: "Понедельник",
    weekSunday: "Воскресенье",
    sizeCompact: "Компактный",
    sizeStandard: "Стандартный",
    sizeWide: "Широкий",
    sizeWebNote: "Размер окна доступен только в десктопной версии.",
    settingsSaved: "Настройки сохранены.",
    "errors.emptyName": "Название привычки не может быть пустым",
    "errors.invalidColor": "Некорректный цвет привычки",
    "errors.duplicateName": "Привычка \"{name}\" уже существует",
    "errors.tooLongName": "Название привычки не может быть длиннее {max} символов",
    "errors.stateBroken": "Состояние данных повреждено",
    "errors.notFound": "Привычка с id {id} не найдена",
    "errors.invalidDate": "Некорректная дата: {date}",
    "errors.dateRange": "Дата должна быть в диапазоне {min}-{max}: {date}",
    "errors.outsideWindow": "Дата вне текущего окна: {date}",
    "errors.newerVersion": "Версия формата {version} новее поддерживаемой {supported}",
    "errors.importParse": "Не удалось разобрать импортируемые данные",
    "errors.unknownCommand": "Неизвестная команда: {command}",
    "errors.sizeWebOnly": "Размер окна доступен только в десктопной версии",
    "errors.backup": "Не удалось создать бэкап данных",
    "errors.copy": "Не удалось скопировать: {error}",
    "errors.saveWindow": "Не удалось изменить размер окна",
    "errors.readData": "Не удалось прочитать файл данных",
    "errors.saveData": "Не удалось сохранить файл данных",
    "errors.exportData": "Не удалось экспортировать данные",
    "errors.idRange": "Диапазон id привычек исчерпан",
    "errors.windowMissing": "Окно приложения не найдено",
  },
  en: {
    kicker: "discipline journal",
    webBadge: "web",
    title: "Habits",
    habitColumn: "Habit",
    navAria: "Date navigation",
    navPrev: "Back",
    navToday: "Today",
    navNext: "Forward",
    calendarAria: "Open calendar",
    calendarTitle: "Pick a date",
    dateAria: "Pick a date",
    rangeDefault: "14 days in view",
    rangeNote: "{first} — {last}",
    searchLabel: "Search habits",
    searchPlaceholder: "search by name...",
    clearSearch: "Clear search",
    historyBtn: "History",
    statsBtn: "Stats",
    dataBtn: "Data",
    settingsBtn: "Settings",
    composerAria: "Add a habit",
    composerLabel: "New habit",
    composerPlaceholder: "read, run, write...",
    colorLabel: "Color",
    colorHint: "You can change the color while editing.",
    "color.clay": "clay",
    "color.indigo": "indigo",
    "color.moss": "moss",
    "color.teal": "teal",
    "color.plum": "plum",
    "color.gold": "ochre",
    "color.slate": "slate",
    "color.rose": "rose",
    addBtn: "Add",
    statusLoading: "Loading...",
    statusSaving: "Saving...",
    statusDeleting: "Deleting...",
    statusRestoring: "Restoring...",
    statusImporting: "Importing...",
    statusBackingUp: "Creating backup...",
    emptyTitle: "Nothing here yet",
    emptyCopy: "Add a habit above. Days and checkboxes will appear in the table.",
    noMatches: "No habits match this search.",
    toolbarAria: "Habit actions",
    boardAria: "Habit board",
    editAria: "Edit habit {name}",
    editColorAria: "Habit color",
    pickColorAria: "Choose a color for {name}",
    habitActionsAria: "Actions for habit {name}",
    dragAria: "Drag habit {name}",
    dragTitle: "Drag",
    renameAria: "Rename habit {name}",
    renameTitle: "Rename",
    saveRenameAria: "Save name",
    saveRenameTitle: "Save",
    cancelRenameAria: "Cancel rename",
    cancelRenameTitle: "Cancel",
    renameInputAria: "New habit name",
    deleteAria: "Delete habit {name}",
    deleteTitle: "Delete",
    deleteDialogTitle: "Delete habit",
    confirmDelete: "Delete \"{name}\"? Completion history will be removed too.",
    deleteConfirm: "Delete",
    deleteCancel: "Cancel",
    themeDarkAria: "Light theme",
    themeLightAria: "Dark theme",
    themeDarkText: "Light",
    themeLightText: "Dark",
    quickControls: "Quick controls",
    langSwitchToEn: "Switch to English",
    langSwitchToRu: "Switch to Russian",
    undoDeleted: "Deleted: {name}",
    undoAction: "Undo",
    undoRestoring: "Restoring...",
    historyTitle: "Full history",
    closeAria: "Close",
    closeTitle: "Close",
    historySummary: "Completions: {count} · Period: {first} — {last}",
    historyEmpty: "No completions yet. Mark days in the table and they will appear here.",
    historyDayColumn: "Day",
    statsTitle: "Statistics",
    statsOverall: "Overall completion",
    statsPeriod: "Tracked period",
    statsTotal: "Total completions",
    statsPerHabit: "Per habit",
    statsHabit: "Habit",
    statsCompleted: "Completions",
    statsPercent: "Completion",
    statsCurrentStreak: "Current streak",
    statsBestStreak: "Best streak",
    statsBestDay: "Best day",
    statsBestWeekday: "Best weekday",
    statsDaysWord: "{count} days",
    statsNoData: "No data for statistics yet.",
    dataTitle: "Data",
    dataSectionExport: "Export",
    dataSectionImport: "Import",
    dataFormatLabel: "Format",
    dataTextLabel: "Data",
    dataExport: "Export",
    dataCopy: "Copy",
    dataDownload: "Download",
    dataBackup: "Backup",
    dataFileLabel: "Load a JSON file",
    dataImport: "Import (replace data)",
    dataImportNote: "Import supports JSON only. CSV/Markdown are export-only.",
    dataExported: "Data loaded into the field. You can copy or download it.",
    dataCopied: "Data copied to clipboard.",
    dataImported: "Data imported.",
    dataBackedUp: "Backup created: {name}",
    dataConfirmImport: "Replace current data with the field/file data? Current data will be saved to a backup.",
    "dataDownloadName.json": "habits.json",
    "dataDownloadName.csv": "habits.csv",
    "dataDownloadName.md": "habits.md",
    settingsTitle: "Settings",
    settingsLanguage: "Language",
    settingsWeekStart: "First day of week",
    settingsWindowSize: "Window size",
    settingsSave: "Save",
    settingsCancel: "Cancel",
    langRu: "Русский",
    langEn: "English",
    weekMonday: "Monday",
    weekSunday: "Sunday",
    sizeCompact: "Compact",
    sizeStandard: "Standard",
    sizeWide: "Wide",
    sizeWebNote: "Window size is available in the desktop version only.",
    settingsSaved: "Settings saved.",
    "errors.emptyName": "Habit name cannot be empty",
    "errors.invalidColor": "Invalid habit color",
    "errors.duplicateName": "Habit \"{name}\" already exists",
    "errors.tooLongName": "Habit name cannot be longer than {max} characters",
    "errors.stateBroken": "Stored data is corrupted",
    "errors.notFound": "Habit with id {id} not found",
    "errors.invalidDate": "Invalid date: {date}",
    "errors.dateRange": "Date must be in range {min}-{max}: {date}",
    "errors.outsideWindow": "Date is outside the current window: {date}",
    "errors.newerVersion": "Format version {version} is newer than supported {supported}",
    "errors.importParse": "Could not parse imported data",
    "errors.unknownCommand": "Unknown command: {command}",
    "errors.sizeWebOnly": "Window size is available in the desktop version only",
    "errors.backup": "Could not create data backup",
    "errors.copy": "Could not copy: {error}",
    "errors.saveWindow": "Could not resize the window",
    "errors.readData": "Could not read the data file",
    "errors.saveData": "Could not save the data file",
    "errors.exportData": "Could not export data",
    "errors.idRange": "Habit id range exhausted",
    "errors.windowMissing": "Application window not found",
  },
};

let locale = loadSettings().language === "en" ? "en" : "ru";

export function getLocale() {
  return locale;
}

export function setLocale(next) {
  locale = next === "en" ? "en" : "ru";
}

export function t(key, vars = {}) {
  const template = DICTS[locale]?.[key] ?? DICTS.ru[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}

const ATTRS = [
  ["data-i18n", "textContent"],
  ["data-i18n-aria", "aria-label"],
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
];

export function applyTranslations(root = document) {
  for (const [attr, prop] of ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      if (!key) continue;
      if (prop.includes("-")) {
        el.setAttribute(prop, t(key));
      } else if (prop in el) {
        el[prop] = t(key);
      }
    }
  }
  document.documentElement.lang = locale;
}

export function localizeError(message) {
  const text = String(message ?? "");
  const tr = (key, vars) => t(key, vars);

  if (text === "Название привычки не может быть пустым") return tr("errors.emptyName");
  if (text === "Некорректный цвет привычки") return tr("errors.invalidColor");
  if (text === "Не удалось прочитать файл данных") return tr("errors.readData");
  if (text === "Не удалось сохранить файл данных") return tr("errors.saveData");
  if (text === "Не удалось экспортировать данные") return tr("errors.exportData");
  if (text === "Диапазон id привычек исчерпан") return tr("errors.idRange");
  if (text === "Окно приложения не найдено") return tr("errors.windowMissing");
  if (text.startsWith("Название привычки не может быть длиннее")) {
    return tr("errors.tooLongName", { max: 80 });
  }
  if (text === "Состояние данных повреждено") return tr("errors.stateBroken");
  if (text === "Размер окна доступен только в десктопной версии") {
    return tr("errors.sizeWebOnly");
  }
  if (text === "Не удалось разобрать импортируемые данные") return tr("errors.importParse");
  if (text === "Не удалось создать бэкап данных") return tr("errors.backup");
  if (text === "Не удалось изменить размер окна") return tr("errors.saveWindow");

  let match = text.match(/^Привычка "(.*)" уже существует$/);
  if (match) return tr("errors.duplicateName", { name: match[1] });
  match = text.match(/^Привычка с id (\d+) не найдена$/);
  if (match) return tr("errors.notFound", { id: match[1] });
  match = text.match(/^Некорректная дата: (.*)$/);
  if (match) return tr("errors.invalidDate", { date: match[1] });
  match = text.match(/^Дата вне текущего окна: (.*)$/);
  if (match) return tr("errors.outsideWindow", { date: match[1] });
  match = text.match(/^Дата должна быть в диапазоне (\d+)-(\d+): (.*)$/);
  if (match) {
    return tr("errors.dateRange", { min: match[1], max: match[2], date: match[3] });
  }
  match = text.match(/^Версия формата (\d+) новее поддерживаемой (\d+)$/);
  if (match) return tr("errors.newerVersion", { version: match[1], supported: match[2] });
  match = text.match(/^Неизвестная команда: (.*)$/);
  if (match) return tr("errors.unknownCommand", { command: match[1] });

  return text;
}
