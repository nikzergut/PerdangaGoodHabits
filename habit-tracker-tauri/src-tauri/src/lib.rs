use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const DATA_FILE: &str = "habits.json";
const DEFAULT_DAYS: i64 = 14;
const MAX_DAYS: i64 = 60;
const MIN_YEAR: i32 = 1900;
const MAX_YEAR: i32 = 2100;
const MAX_NAME_LEN: usize = 80;
const SCHEMA_VERSION: u32 = 2;
const HABIT_COLORS: [&str; 8] = [
    "clay", "indigo", "moss", "teal", "plum", "gold", "slate", "rose",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Habit {
    id: u32,
    name: String,
    created_at: String,
    completions: Vec<String>,
    #[serde(default)]
    color: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Store {
    #[serde(default)]
    version: u32,
    #[serde(default, alias = "next_id")]
    next_id: u32,
    #[serde(default)]
    habits: Vec<Habit>,
}

struct AppState {
    path: PathBuf,
    store: Mutex<Store>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DayCell {
    date: String,
    label: String,
    weekday: String,
    is_today: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HabitView {
    id: u32,
    name: String,
    created_at: String,
    completions: Vec<String>,
    color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardResponse {
    anchor: String,
    days: Vec<DayCell>,
    habits: Vec<HabitView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToggleResponse {
    habit_id: u32,
    date: String,
    completed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryHabit {
    id: u32,
    name: String,
    created_at: String,
    completions: Vec<String>,
    color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryResponse {
    habits: Vec<HistoryHabit>,
    total_completions: usize,
    first_date: Option<String>,
    last_date: Option<String>,
}

fn detailed_error(user_message: &str, detail: impl std::fmt::Display) -> String {
    eprintln!("{user_message}: {detail}");
    user_message.to_string()
}

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| detailed_error("Не удалось определить каталог данных", e))?;
    fs::create_dir_all(&dir).map_err(|e| {
        detailed_error(
            "Не удалось создать каталог данных",
            format!("{}: {e}", dir.display()),
        )
    })?;
    Ok(dir.join(DATA_FILE))
}

fn default_store() -> Store {
    Store {
        version: SCHEMA_VERSION,
        next_id: 1,
        habits: Vec::new(),
    }
}

fn is_valid_color(color: &str) -> bool {
    HABIT_COLORS.contains(&color)
}

fn color_for_index(index: usize) -> String {
    HABIT_COLORS[index % HABIT_COLORS.len()].to_string()
}

fn validate_color(color: &str, allow_empty: bool) -> Result<(), String> {
    if (allow_empty && color.trim().is_empty()) || is_valid_color(color.trim()) {
        Ok(())
    } else {
        Err("Некорректный цвет привычки".to_string())
    }
}

fn resolve_color_arg(color: Option<&str>, fallback: String) -> Result<String, String> {
    match color {
        None => Ok(fallback),
        Some(raw) => {
            let color = raw.trim();
            if color.is_empty() {
                Ok(fallback)
            } else {
                validate_color(color, false)?;
                Ok(color.to_string())
            }
        }
    }
}

fn temp_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn normalize_store(mut store: Store) -> Result<Store, String> {
    if store.version > SCHEMA_VERSION {
        return Err(format!(
            "Версия формата {} новее поддерживаемой {SCHEMA_VERSION}",
            store.version
        ));
    }
    store.version = SCHEMA_VERSION;

    let mut used = HashSet::new();
    let mut candidate = store.next_id.max(1);
    for (index, habit) in store.habits.iter_mut().enumerate() {
        if habit.id == 0 || !used.insert(habit.id) {
            loop {
                let id = candidate;
                candidate = candidate
                    .checked_add(1)
                    .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?;
                if !used.contains(&id) {
                    habit.id = id;
                    used.insert(id);
                    break;
                }
            }
        }
        let color = habit.color.trim();
        habit.color = if is_valid_color(color) {
            color.to_string()
        } else {
            color_for_index(index)
        };
        if parse_date(habit.created_at.trim()).is_err() {
            habit.created_at = today_naive().format("%Y-%m-%d").to_string();
        } else {
            habit.created_at = habit.created_at.trim().to_string();
        }
        habit
            .completions
            .retain(|date| parse_date(date.trim()).is_ok());
        habit.completions = habit
            .completions
            .iter()
            .map(|date| date.trim().to_string())
            .collect();
        habit.completions.sort();
        habit.completions.dedup();
    }

    let max_id = used.iter().copied().max().unwrap_or(0);
    let next_after_max = max_id
        .checked_add(1)
        .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?;
    store.next_id = candidate.max(next_after_max).max(1);

    Ok(store)
}

fn read_store_file(path: &PathBuf) -> Result<Store, String> {
    let content = fs::read_to_string(path).map_err(|e| {
        detailed_error(
            "Не удалось прочитать файл данных",
            format!("{}: {e}", path.display()),
        )
    })?;
    if content.trim().is_empty() {
        return Ok(default_store());
    }
    let store: Store = serde_json::from_str(&content).map_err(|e| {
        detailed_error(
            "Не удалось разобрать файл данных",
            format!("{}: {e}", path.display()),
        )
    })?;
    normalize_store(store)
}

fn recover_from_temp(path: &PathBuf, tmp: &PathBuf) -> Result<Store, String> {
    let content = fs::read_to_string(tmp).map_err(|e| {
        detailed_error(
            "Не удалось прочитать временный файл",
            format!("{}: {e}", tmp.display()),
        )
    })?;
    if content.trim().is_empty() {
        return Err("Временный файл пуст".to_string());
    }

    let store = read_store_file(tmp)?;
    save_store_to_path(path, &store).map_err(|e| {
        detailed_error(
            "Не удалось восстановить данные из временного файла",
            format!("{}: {e}", path.display()),
        )
    })?;
    Ok(store)
}

fn load_store_from_path(path: &PathBuf) -> Result<Store, String> {
    let tmp = temp_path(path);

    if !path.exists() {
        return match recover_from_temp(path, &tmp) {
            Ok(store) => {
                eprintln!("Восстановлены данные из {}", tmp.display());
                Ok(store)
            }
            Err(_) => Ok(default_store()),
        };
    }

    match read_store_file(path) {
        Ok(store) => {
            if tmp.exists() {
                let _ = fs::remove_file(&tmp);
            }
            Ok(store)
        }
        Err(err) => {
            eprintln!("Не удалось загрузить {}: {err}", path.display());

            let bak = backup_path(path);
            match fs::copy(path, &bak) {
                Ok(_) => eprintln!("Повреждённый файл скопирован в {}", bak.display()),
                Err(e) => eprintln!("Не удалось создать бэкап {}: {e}", bak.display()),
            }

            match recover_from_temp(path, &tmp) {
                Ok(store) => {
                    eprintln!("Восстановлены данные из {}", tmp.display());
                    Ok(store)
                }
                Err(_) => {
                    eprintln!("Запускаем с пустым хранилищем");
                    Ok(default_store())
                }
            }
        }
    }
}

fn save_store_to_path(path: &PathBuf, store: &Store) -> Result<(), String> {
    let content = serde_json::to_string_pretty(store)
        .map_err(|e| detailed_error("Не удалось сериализовать данные", e))?;
    let tmp = temp_path(path);

    let mut file = File::create(&tmp).map_err(|e| {
        detailed_error(
            "Не удалось создать временный файл",
            format!("{}: {e}", tmp.display()),
        )
    })?;
    file.write_all(content.as_bytes()).map_err(|e| {
        detailed_error(
            "Не удалось записать временный файл",
            format!("{}: {e}", tmp.display()),
        )
    })?;
    file.sync_all().map_err(|e| {
        detailed_error(
            "Не удалось синхронизировать временный файл",
            format!("{}: {e}", tmp.display()),
        )
    })?;
    drop(file);

    fs::rename(&tmp, path).map_err(|e| {
        detailed_error(
            "Не удалось сохранить файл данных",
            format!("{}: {e}", path.display()),
        )
    })
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Название привычки не может быть пустым".into());
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "Название привычки не может быть длиннее {MAX_NAME_LEN} символов"
        ));
    }
    Ok(())
}

fn ensure_name_available(store: &Store, name: &str, except_id: Option<u32>) -> Result<(), String> {
    if store
        .habits
        .iter()
        .any(|h| Some(h.id) != except_id && h.name.to_lowercase() == name.to_lowercase())
    {
        return Err(format!("Привычка \"{name}\" уже существует"));
    }
    Ok(())
}

fn add_habit_to_store(store: &Store, name: &str, color: Option<&str>) -> Result<Store, String> {
    let name = name.trim();
    validate_name(name)?;
    ensure_name_available(store, name, None)?;
    let color = resolve_color_arg(color, color_for_index(store.habits.len()))?;

    let mut next = store.clone();
    next.habits.push(Habit {
        id: next.next_id,
        name: name.to_string(),
        created_at: today_naive().format("%Y-%m-%d").to_string(),
        completions: Vec::new(),
        color,
    });
    next.next_id = next
        .next_id
        .checked_add(1)
        .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?;
    Ok(next)
}

fn rename_habit_in_store(
    store: &Store,
    id: u32,
    name: &str,
    color: Option<&str>,
) -> Result<Store, String> {
    let name = name.trim();
    validate_name(name)?;
    let existing = store
        .habits
        .iter()
        .find(|h| h.id == id)
        .ok_or_else(|| format!("Привычка с id {id} не найдена"))?;
    ensure_name_available(store, name, Some(id))?;
    let color = resolve_color_arg(color, existing.color.clone())?;

    let mut next = store.clone();
    let habit = next
        .habits
        .iter_mut()
        .find(|h| h.id == id)
        .expect("id checked above");
    habit.name = name.to_string();
    habit.color = color;
    Ok(next)
}

fn delete_habit_from_store(store: &Store, id: u32) -> Result<Store, String> {
    let mut next = store.clone();
    let before = next.habits.len();
    next.habits.retain(|h| h.id != id);
    if next.habits.len() == before {
        return Err(format!("Привычка с id {id} не найдена"));
    }
    Ok(next)
}

fn move_habit_in_store(store: &Store, id: u32, to_index: usize) -> Result<Store, String> {
    let from = store
        .habits
        .iter()
        .position(|h| h.id == id)
        .ok_or_else(|| format!("Привычка с id {id} не найдена"))?;

    let mut next = store.clone();
    let max = next.habits.len().saturating_sub(1);
    let mut to = to_index.min(max);
    let habit = next.habits.remove(from);
    if to > next.habits.len() {
        to = next.habits.len();
    }
    next.habits.insert(to, habit);
    Ok(next)
}

fn toggle_day_in_store(store: &Store, habit_id: u32, date: &str) -> Result<(Store, bool), String> {
    let mut next = store.clone();
    let habit = next
        .habits
        .iter_mut()
        .find(|h| h.id == habit_id)
        .ok_or_else(|| format!("Привычка с id {habit_id} не найдена"))?;

    let completed = if let Some(pos) = habit.completions.iter().position(|d| d == date) {
        habit.completions.remove(pos);
        false
    } else {
        habit.completions.push(date.to_string());
        habit.completions.sort();
        habit.completions.dedup();
        true
    };

    Ok((next, completed))
}

fn validate_store_data(store: &Store) -> Result<(), String> {
    let mut names = HashSet::new();
    for habit in &store.habits {
        let name = habit.name.trim();
        validate_name(name)?;
        validate_color(&habit.color, true)?;
        if !names.insert(name.to_lowercase()) {
            return Err(format!("Привычка \"{name}\" уже существует"));
        }
        validate_date(parse_date(habit.created_at.trim())?)?;
        for date in &habit.completions {
            validate_date(parse_date(date.trim())?)?;
        }
    }
    Ok(())
}

fn history_from_store(store: &Store) -> HistoryResponse {
    let habits: Vec<HistoryHabit> = store
        .habits
        .iter()
        .map(|h| HistoryHabit {
            id: h.id,
            name: h.name.clone(),
            created_at: h.created_at.clone(),
            color: h.color.clone(),
            completions: {
                let mut dates = h.completions.clone();
                dates.sort();
                dates.dedup();
                dates
            },
        })
        .collect();

    let mut all_dates: Vec<String> = habits
        .iter()
        .flat_map(|h| h.completions.iter().cloned())
        .collect();
    all_dates.sort();
    all_dates.dedup();

    HistoryResponse {
        total_completions: habits.iter().map(|h| h.completions.len()).sum(),
        first_date: all_dates.first().cloned(),
        last_date: all_dates.last().cloned(),
        habits,
    }
}

fn restore_habit_in_store(
    store: &Store,
    habit: &Habit,
    index: Option<usize>,
) -> Result<Store, String> {
    let name = habit.name.trim();
    validate_name(name)?;
    validate_color(&habit.color, true)?;
    validate_date(parse_date(habit.created_at.trim())?)?;
    for date in &habit.completions {
        validate_date(parse_date(date.trim())?)?;
    }

    let mut next = store.clone();
    if next
        .habits
        .iter()
        .any(|h| h.name.to_lowercase() == name.to_lowercase())
    {
        return Err(format!("Привычка \"{name}\" уже существует"));
    }

    let mut restored = habit.clone();
    restored.name = name.to_string();
    let color = restored.color.trim();
    restored.color = if is_valid_color(color) {
        color.to_string()
    } else {
        color_for_index(next.habits.len())
    };
    restored.completions.sort();
    restored.completions.dedup();

    if next.habits.iter().any(|h| h.id == restored.id) {
        restored.id = next.next_id;
    }
    let max_id = next.habits.iter().map(|h| h.id).max().unwrap_or(0);
    next.next_id = restored
        .id
        .checked_add(1)
        .and_then(|v| max_id.checked_add(1).map(|m| v.max(m)))
        .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?
        .max(next.next_id);
    let insert_at = index.unwrap_or(next.habits.len()).min(next.habits.len());
    next.habits.insert(insert_at, restored);
    Ok(next)
}

fn write_backup(path: &PathBuf, store: &Store) -> Result<String, String> {
    let bak = backup_path(path);
    let label = bak
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| DATA_FILE.to_string());

    if path.exists() {
        fs::copy(path, &bak).map_err(|e| {
            detailed_error(
                "Не удалось создать бэкап данных",
                format!("{}: {e}", bak.display()),
            )
        })?;
    } else {
        let content = serde_json::to_string_pretty(store)
            .map_err(|e| detailed_error("Не удалось сериализовать данные", e))?;
        fs::write(&bak, content).map_err(|e| {
            detailed_error(
                "Не удалось создать бэкап данных",
                format!("{}: {e}", bak.display()),
            )
        })?;
    }
    Ok(label)
}

fn today_naive() -> NaiveDate {
    Local::now().date_naive()
}

fn validate_date(date: NaiveDate) -> Result<NaiveDate, String> {
    let year = date.year();
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return Err(format!(
            "Дата должна быть в диапазоне {MIN_YEAR}-{MAX_YEAR}: {}",
            date.format("%Y-%m-%d")
        ));
    }
    Ok(date)
}

fn parse_date(date: &str) -> Result<NaiveDate, String> {
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("Некорректная дата: {date}"))?;
    validate_date(parsed)
}

fn weekday_short(date: NaiveDate) -> String {
    match date.format("%a").to_string().as_str() {
        "Mon" => "Пн",
        "Tue" => "Вт",
        "Wed" => "Ср",
        "Thu" => "Чт",
        "Fri" => "Пт",
        "Sat" => "Сб",
        "Sun" => "Вс",
        other => return other.to_string(),
    }
    .to_string()
}

fn build_days(anchor: NaiveDate, days: i64) -> Result<Vec<DayCell>, String> {
    let today = today_naive();
    let count = days.clamp(1, MAX_DAYS);
    (0..count)
        .map(|offset| {
            let date = anchor
                .checked_add_signed(Duration::days(offset))
                .ok_or_else(|| {
                    format!(
                        "Дата вне допустимого диапазона: {}",
                        anchor.format("%Y-%m-%d")
                    )
                })?;
            let date = validate_date(date)?;
            Ok(DayCell {
                date: date.format("%Y-%m-%d").to_string(),
                label: date.format("%d.%m").to_string(),
                weekday: weekday_short(date),
                is_today: date == today,
            })
        })
        .collect()
}

fn ensure_date_in_window(date: NaiveDate, anchor: NaiveDate, days: i64) -> Result<(), String> {
    let date_str = date.format("%Y-%m-%d").to_string();
    let visible = build_days(anchor, days)?;
    if visible.iter().any(|d| d.date == date_str) {
        Ok(())
    } else {
        Err(format!("Дата вне текущего окна: {date_str}"))
    }
}

fn board_from_store(store: &Store, anchor: NaiveDate, days: i64) -> Result<BoardResponse, String> {
    let days_vec = build_days(anchor, days)?;
    let visible: HashSet<String> = days_vec.iter().map(|d| d.date.clone()).collect();
    Ok(BoardResponse {
        anchor: anchor.format("%Y-%m-%d").to_string(),
        days: days_vec,
        habits: store
            .habits
            .iter()
            .map(|h| HabitView {
                id: h.id,
                name: h.name.clone(),
                created_at: h.created_at.clone(),
                color: h.color.clone(),
                completions: h
                    .completions
                    .iter()
                    .filter(|d| visible.contains(*d))
                    .cloned()
                    .collect(),
            })
            .collect(),
    })
}

fn resolve_anchor(anchor: Option<String>) -> Result<NaiveDate, String> {
    match anchor {
        Some(a) if !a.trim().is_empty() => parse_date(&a),
        _ => validate_date(today_naive() - Duration::days(DEFAULT_DAYS / 2)),
    }
}

#[tauri::command]
fn get_board(
    state: tauri::State<'_, AppState>,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let days = days.unwrap_or(DEFAULT_DAYS);
    let store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    board_from_store(&store, anchor_date, days)
}

#[tauri::command]
fn add_habit(
    state: tauri::State<'_, AppState>,
    name: String,
    color: Option<String>,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = add_habit_to_store(&store, &name, color.as_deref())?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn rename_habit(
    state: tauri::State<'_, AppState>,
    id: u32,
    name: String,
    color: Option<String>,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = rename_habit_in_store(&store, id, &name, color.as_deref())?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn delete_habit(
    state: tauri::State<'_, AppState>,
    id: u32,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = delete_habit_from_store(&store, id)?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn toggle_day(
    state: tauri::State<'_, AppState>,
    habit_id: u32,
    date: String,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<ToggleResponse, String> {
    let date = date.trim().to_string();
    let parsed = parse_date(&date)?;
    let anchor_date = resolve_anchor(anchor)?;
    ensure_date_in_window(parsed, anchor_date, days.unwrap_or(DEFAULT_DAYS))?;

    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let (next, completed) = toggle_day_in_store(&store, habit_id, &date)?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    Ok(ToggleResponse {
        habit_id,
        date,
        completed,
    })
}

#[tauri::command]
fn get_history(state: tauri::State<'_, AppState>) -> Result<HistoryResponse, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    Ok(history_from_store(&store))
}

#[tauri::command]
fn export_data(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    serde_json::to_string_pretty(&*store)
        .map_err(|e| detailed_error("Не удалось экспортировать данные", e))
}

#[tauri::command]
fn import_data(
    state: tauri::State<'_, AppState>,
    json: String,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let parsed: Store = serde_json::from_str(json.trim())
        .map_err(|e| detailed_error("Не удалось разобрать импортируемые данные", e))?;
    validate_store_data(&parsed)?;
    let next = normalize_store(parsed)?;

    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    write_backup(&state.path, &store)?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn backup_data(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    write_backup(&state.path, &store)
}

#[tauri::command]
fn restore_habit(
    state: tauri::State<'_, AppState>,
    habit: Habit,
    index: Option<usize>,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = restore_habit_in_store(&store, &habit, index)?;
    save_store_to_path(&state.path, &next)?;
    *store = next;

    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn move_habit(
    state: tauri::State<'_, AppState>,
    id: u32,
    to_index: usize,
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = move_habit_in_store(&store, id, to_index)?;
    save_store_to_path(&state.path, &next)?;
    *store = next;
    board_from_store(&store, anchor_date, days.unwrap_or(DEFAULT_DAYS))
}

#[tauri::command]
fn set_window_size(app: tauri::AppHandle, width: u32, height: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Окно приложения не найдено".to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| detailed_error("Не удалось изменить размер окна", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            let path = data_file(app.handle())?;
            let store = load_store_from_path(&path)?;
            app.manage(AppState {
                path,
                store: Mutex::new(store),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_board,
            get_history,
            add_habit,
            rename_habit,
            delete_habit,
            move_habit,
            toggle_day,
            export_data,
            import_data,
            backup_data,
            restore_habit,
            set_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_PATH_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn test_path() -> PathBuf {
        let n = TEST_PATH_COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "habit-tracker-test-{}-{nanos}-{n}.json",
            std::process::id()
        ))
    }

    fn cleanup_test_files(path: &PathBuf) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(temp_path(path));
        let _ = fs::remove_file(backup_path(path));
    }

    #[test]
    fn parse_date_accepts_valid_date() {
        let date = parse_date("2026-11-25").unwrap();
        assert_eq!(date.to_string(), "2026-11-25");
    }

    #[test]
    fn parse_date_rejects_out_of_range_year() {
        assert!(parse_date("9999-12-31").is_err());
        assert!(parse_date("0001-01-01").is_err());
    }

    #[test]
    fn resolve_anchor_rejects_extreme_date() {
        assert!(resolve_anchor(Some("9999-12-31".to_string())).is_err());
    }

    #[test]
    fn build_days_returns_requested_count() {
        let anchor = NaiveDate::from_ymd_opt(2026, 11, 18).unwrap();
        let days = build_days(anchor, DEFAULT_DAYS).unwrap();
        assert_eq!(days.len(), DEFAULT_DAYS as usize);
        assert_eq!(days.last().unwrap().date, "2026-12-01");
    }

    #[test]
    fn build_days_rejects_overflowing_window() {
        let anchor = NaiveDate::from_ymd_opt(MAX_YEAR, 12, 25).unwrap();
        assert!(build_days(anchor, DEFAULT_DAYS).is_err());
    }

    #[test]
    fn board_from_store_uses_supplied_anchor() {
        let store = sample_store();
        let anchor = NaiveDate::from_ymd_opt(2020, 1, 1).unwrap();
        let board = board_from_store(&store, anchor, 3).unwrap();

        assert_eq!(board.anchor, "2020-01-01");
        assert_eq!(board.days.len(), 3);
        assert_eq!(board.days[0].date, "2020-01-01");
    }

    fn sample_store() -> Store {
        Store {
            version: SCHEMA_VERSION,
            next_id: 2,
            habits: vec![Habit {
                id: 1,
                name: "Чтение".to_string(),
                created_at: "2026-11-01".to_string(),
                completions: Vec::new(),
                color: "clay".to_string(),
            }],
        }
    }

    #[test]
    fn add_habit_to_store_does_not_mutate_source() {
        let store = sample_store();
        let next = add_habit_to_store(&store, "Бег", None).unwrap();

        assert_eq!(store.habits.len(), 1);
        assert_eq!(store.next_id, 2);
        assert_eq!(next.habits.len(), 2);
        assert_eq!(next.next_id, 3);
        assert_eq!(next.habits[1].name, "Бег");
        assert_eq!(next.habits[1].color, "indigo");
    }

    #[test]
    fn rename_habit_in_store_preserves_history() {
        let mut store = sample_store();
        store.habits[0].completions.push("2026-11-25".to_string());

        let next = rename_habit_in_store(&store, 1, "  Бег  ", Some("moss")).unwrap();

        assert_eq!(store.habits[0].name, "Чтение");
        assert_eq!(next.habits[0].name, "Бег");
        assert_eq!(next.habits[0].completions, vec!["2026-11-25".to_string()]);
        assert_eq!(next.habits[0].color, "moss");
        assert_eq!(store.habits[0].color, "clay");
        assert_eq!(next.next_id, store.next_id);
    }

    #[test]
    fn rename_habit_in_store_rejects_duplicate() {
        let mut store = sample_store();
        store.habits.push(Habit {
            id: 2,
            name: "Бег".to_string(),
            created_at: "2026-11-01".to_string(),
            completions: Vec::new(),
            color: "teal".to_string(),
        });

        assert!(rename_habit_in_store(&store, 1, "бег", None).is_err());
    }

    #[test]
    fn rename_habit_in_store_rejects_missing_id() {
        let store = sample_store();
        assert!(rename_habit_in_store(&store, 99, "Бег", None).is_err());
    }

    #[test]
    fn delete_habit_from_store_does_not_mutate_source() {
        let store = sample_store();
        let next = delete_habit_from_store(&store, 1).unwrap();

        assert_eq!(store.habits.len(), 1);
        assert!(next.habits.is_empty());
    }

    #[test]
    fn toggle_day_in_store_does_not_mutate_source() {
        let store = sample_store();
        let (next, completed) = toggle_day_in_store(&store, 1, "2026-11-25").unwrap();

        assert!(completed);
        assert!(store.habits[0].completions.is_empty());
        assert_eq!(next.habits[0].completions, vec!["2026-11-25".to_string()]);

        let (next2, completed2) = toggle_day_in_store(&next, 1, "2026-11-25").unwrap();
        assert!(!completed2);
        assert!(next2.habits[0].completions.is_empty());
    }

    #[test]
    fn normalize_store_migrates_legacy_and_fixes_next_id() {
        let legacy = Store {
            version: 0,
            next_id: 1,
            habits: vec![Habit {
                id: 7,
                name: "Чтение".to_string(),
                created_at: "2026-11-01".to_string(),
                completions: Vec::new(),
                color: String::new(),
            }],
        };

        let migrated = normalize_store(legacy).unwrap();
        assert_eq!(migrated.version, SCHEMA_VERSION);
        assert_eq!(migrated.next_id, 8);
        assert_eq!(migrated.habits[0].color, "clay");
    }

    #[test]
    fn normalize_store_repairs_invalid_dates() {
        let raw: Store = serde_json::from_str(
            r#"{"version":1,"nextId":2,"habits":[{"id":1,"name":"Чтение","createdAt":"bad","completions":["2026-01-01","2026-13-45"]}]}"#,
        )
        .unwrap();

        let normalized = normalize_store(raw).unwrap();
        assert_ne!(normalized.habits[0].created_at, "bad");
        assert_eq!(normalized.habits[0].completions, vec!["2026-01-01"]);
    }

    #[test]
    fn normalize_store_rejects_future_version() {
        let future = Store {
            version: SCHEMA_VERSION + 1,
            next_id: 1,
            habits: Vec::new(),
        };
        assert!(normalize_store(future).is_err());
    }

    #[test]
    fn add_habit_to_store_rejects_long_name() {
        let store = sample_store();
        let long_name = "а".repeat(MAX_NAME_LEN + 1);
        assert!(add_habit_to_store(&store, &long_name, None).is_err());
    }

    #[test]
    fn normalize_store_reassigns_duplicate_and_zero_ids() {
        let raw = Store {
            version: SCHEMA_VERSION,
            next_id: 2,
            habits: [1, 1, 0]
                .into_iter()
                .map(|id| Habit {
                    id,
                    name: format!("Привычка {id}"),
                    created_at: "2026-11-01".to_string(),
                    completions: Vec::new(),
                    color: String::new(),
                })
                .collect(),
        };

        let normalized = normalize_store(raw).unwrap();
        let ids: Vec<u32> = normalized.habits.iter().map(|h| h.id).collect();
        assert_eq!(ids, vec![1, 2, 3]);
        let colors: Vec<&str> = normalized.habits.iter().map(|h| h.color.as_str()).collect();
        assert_eq!(colors, vec!["clay", "indigo", "moss"]);
        assert_eq!(normalized.next_id, 4);
    }

    #[test]
    fn ensure_date_in_window_rejects_outside_date() {
        let anchor = NaiveDate::from_ymd_opt(2026, 11, 18).unwrap();
        let inside = NaiveDate::from_ymd_opt(2026, 11, 18).unwrap();
        let outside = NaiveDate::from_ymd_opt(2026, 11, 30).unwrap();

        assert!(ensure_date_in_window(inside, anchor, 3).is_ok());
        assert!(ensure_date_in_window(outside, anchor, 3).is_err());
    }

    #[test]
    fn save_and_load_store_roundtrip() {
        let path = test_path();
        let store = sample_store();

        save_store_to_path(&path, &store).unwrap();
        assert!(path.exists());
        assert!(!temp_path(&path).exists());

        let loaded = load_store_from_path(&path).unwrap();
        assert_eq!(loaded.version, SCHEMA_VERSION);
        assert_eq!(loaded.habits.len(), 1);
        assert_eq!(loaded.next_id, store.next_id);

        cleanup_test_files(&path);
    }

    #[test]
    fn save_error_hides_absolute_path() {
        let marker = format!(
            "hidden-dir-{}",
            TEST_PATH_COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let path = std::env::temp_dir().join(marker).join(DATA_FILE);

        let err = save_store_to_path(&path, &sample_store()).unwrap_err();

        assert_eq!(err, "Не удалось создать временный файл");
        assert!(!err.contains("hidden-dir"));
        assert!(!err.contains(std::path::MAIN_SEPARATOR));
    }

    #[test]
    fn load_store_from_path_backs_up_corrupt_file() {
        let path = test_path();
        fs::write(&path, "{ broken json").unwrap();

        let store = load_store_from_path(&path).unwrap();
        assert!(store.habits.is_empty());
        assert!(backup_path(&path).exists());

        cleanup_test_files(&path);
    }

    #[test]
    fn load_store_from_path_recovers_temp_file() {
        let path = test_path();
        let tmp = temp_path(&path);
        fs::write(&tmp, serde_json::to_string(&sample_store()).unwrap()).unwrap();

        let store = load_store_from_path(&path).unwrap();
        assert_eq!(store.habits.len(), 1);
        assert!(path.exists());
        assert!(!tmp.exists());

        cleanup_test_files(&path);
    }

    #[test]
    fn load_store_from_path_normalizes_recovered_temp_file() {
        let path = test_path();
        let tmp = temp_path(&path);
        let legacy = r#"{"version":1,"nextId":2,"habits":[{"id":1,"name":"Чтение","createdAt":"2026-11-01","completions":[]}]}"#;
        fs::write(&tmp, legacy).unwrap();

        let store = load_store_from_path(&path).unwrap();
        assert_eq!(store.habits[0].color, "clay");
        let on_disk: Store = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(on_disk.version, SCHEMA_VERSION);
        assert_eq!(on_disk.habits[0].color, "clay");
        assert!(!tmp.exists());

        cleanup_test_files(&path);
    }

    #[test]
    fn store_uses_camel_case_and_reads_legacy_next_id() {
        let serialized = serde_json::to_string(&sample_store()).unwrap();
        assert!(serialized.contains("\"nextId\""));
        assert!(serialized.contains("\"createdAt\""));

        let legacy = r#"{"version":1,"next_id":5,"habits":[]}"#;
        let store: Store = serde_json::from_str(legacy).unwrap();
        assert_eq!(store.next_id, 5);
    }

    #[test]
    fn history_from_store_reports_full_timeline() {
        let mut store = sample_store();
        store.habits[0].completions = vec![
            "2026-11-25".to_string(),
            "2026-11-01".to_string(),
            "2026-11-01".to_string(),
        ];

        let history = history_from_store(&store);
        assert_eq!(history.total_completions, 2);
        assert_eq!(
            history.habits[0].completions,
            vec!["2026-11-01", "2026-11-25"]
        );
        assert_eq!(history.first_date.as_deref(), Some("2026-11-01"));
        assert_eq!(history.last_date.as_deref(), Some("2026-11-25"));
    }

    #[test]
    fn validate_store_data_rejects_invalid_import() {
        let mut store = sample_store();
        store.habits[0].name = String::new();
        assert!(validate_store_data(&store).is_err());

        let mut store = sample_store();
        store.habits[0].completions.push("9999-01-01".to_string());
        assert!(validate_store_data(&store).is_err());

        let mut store = sample_store();
        store.habits.push(store.habits[0].clone());
        assert!(validate_store_data(&store).is_err());
    }

    #[test]
    fn validate_store_data_rejects_invalid_color() {
        let mut store = sample_store();
        store.habits[0].color = "neon".to_string();
        assert!(validate_store_data(&store).is_err());
    }

    #[test]
    fn add_habit_to_store_rejects_invalid_color() {
        let store = sample_store();
        assert!(add_habit_to_store(&store, "Бег", Some("neon")).is_err());
    }

    #[test]
    fn board_and_history_expose_color() {
        let store = sample_store();
        let anchor = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let board = board_from_store(&store, anchor, 1).unwrap();
        assert_eq!(board.habits[0].color, "clay");

        let history = history_from_store(&store);
        assert_eq!(history.habits[0].color, "clay");
    }

    #[test]
    fn store_serializes_color_field() {
        let serialized = serde_json::to_string(&sample_store()).unwrap();
        assert!(serialized.contains("\"color\":\"clay\""));
    }

    #[test]
    fn restore_habit_in_store_preserves_history_and_position() {
        let mut store = sample_store();
        store.habits.push(Habit {
            id: 2,
            name: "Бег".to_string(),
            created_at: "2026-11-01".to_string(),
            completions: Vec::new(),
            color: "moss".to_string(),
        });
        let deleted = store.habits.remove(0);

        let restored = restore_habit_in_store(&store, &deleted, Some(0)).unwrap();
        assert_eq!(restored.habits[0].id, 1);
        assert_eq!(restored.habits[0].completions, deleted.completions);
        assert_eq!(restored.habits[0].color, "clay");
        assert_eq!(restored.habits[1].id, 2);
        assert_eq!(restored.next_id, 3);
    }

    #[test]
    fn restore_habit_in_store_reassigns_colliding_id() {
        let mut store = sample_store();
        store.habits[0].name = "Бег".to_string();
        let deleted = Habit {
            id: 1,
            name: "Чтение".to_string(),
            created_at: "2026-11-01".to_string(),
            completions: Vec::new(),
            color: String::new(),
        };

        let restored = restore_habit_in_store(&store, &deleted, Some(1)).unwrap();
        assert_eq!(restored.habits.len(), 2);
        assert_eq!(restored.habits[1].id, 2);
        assert_eq!(restored.habits[1].color, "indigo");
        assert_eq!(restored.next_id, 3);
    }

    #[test]
    fn move_habit_in_store_reorders_by_index() {
        let mut store = sample_store();
        store.habits.push(Habit {
            id: 2,
            name: "Бег".to_string(),
            created_at: "2026-11-01".to_string(),
            completions: Vec::new(),
            color: "moss".to_string(),
        });
        store.habits.push(Habit {
            id: 3,
            name: "Письмо".to_string(),
            created_at: "2026-11-01".to_string(),
            completions: Vec::new(),
            color: "teal".to_string(),
        });

        let moved = move_habit_in_store(&store, 3, 0).unwrap();
        assert_eq!(
            moved.habits.iter().map(|h| h.id).collect::<Vec<_>>(),
            vec![3, 1, 2]
        );

        let clamped = move_habit_in_store(&store, 1, 99).unwrap();
        assert_eq!(
            clamped.habits.iter().map(|h| h.id).collect::<Vec<_>>(),
            vec![2, 3, 1]
        );
        assert!(move_habit_in_store(&store, 99, 0).is_err());
    }

    #[test]
    fn write_backup_creates_named_file() {
        let path = test_path();
        save_store_to_path(&path, &sample_store()).unwrap();

        let label = write_backup(&path, &sample_store()).unwrap();
        assert!(label.ends_with(".bak"));
        assert!(!label.contains(std::path::MAIN_SEPARATOR));
        assert!(backup_path(&path).exists());

        cleanup_test_files(&path);
    }
}
