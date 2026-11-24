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
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Habit {
    id: u32,
    name: String,
    created_at: String,
    completions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct Store {
    #[serde(default)]
    version: u32,
    next_id: u32,
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
    completions: Vec<String>,
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

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Не удалось определить каталог данных: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать каталог {}: {e}", dir.display()))?;
    Ok(dir.join(DATA_FILE))
}

fn default_store() -> Store {
    Store {
        version: SCHEMA_VERSION,
        next_id: 1,
        habits: Vec::new(),
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
    for habit in &mut store.habits {
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
    }

    let max_id = used.iter().copied().max().unwrap_or(0);
    let next_after_max = max_id
        .checked_add(1)
        .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?;
    store.next_id = candidate.max(next_after_max).max(1);

    Ok(store)
}

fn read_store_file(path: &PathBuf) -> Result<Store, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(default_store());
    }
    let store: Store = serde_json::from_str(&content)
        .map_err(|e| format!("Не удалось разобрать {}: {e}", path.display()))?;
    normalize_store(store)
}

fn recover_from_temp(path: &PathBuf, tmp: &PathBuf) -> Result<Store, String> {
    let content = fs::read_to_string(tmp)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", tmp.display()))?;
    if content.trim().is_empty() {
        return Err("Временный файл пуст".to_string());
    }

    let store = read_store_file(tmp)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| {
            format!(
                "Не удалось удалить повреждённый файл {}: {e}",
                path.display()
            )
        })?;
    }
    fs::rename(tmp, path)
        .map_err(|e| format!("Не удалось восстановить {}: {e}", path.display()))?;
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
        .map_err(|e| format!("Не удалось сериализовать данные: {e}"))?;
    let tmp = temp_path(path);

    let mut file = File::create(&tmp)
        .map_err(|e| format!("Не удалось создать временный файл {}: {e}", tmp.display()))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Не удалось записать временный файл {}: {e}", tmp.display()))?;
    file.sync_all()
        .map_err(|e| format!("Не удалось синхронизировать {}: {e}", tmp.display()))?;
    drop(file);

    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("Не удалось заменить {}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        format!(
            "Не удалось переименовать {} в {}: {e}",
            tmp.display(),
            path.display()
        )
    })
}

fn add_habit_to_store(store: &Store, name: &str) -> Result<Store, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Название привычки не может быть пустым".into());
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "Название привычки не может быть длиннее {MAX_NAME_LEN} символов"
        ));
    }
    if store
        .habits
        .iter()
        .any(|h| h.name.to_lowercase() == name.to_lowercase())
    {
        return Err(format!("Привычка \"{name}\" уже существует"));
    }

    let mut next = store.clone();
    next.habits.push(Habit {
        id: next.next_id,
        name: name.to_string(),
        created_at: today_naive().format("%Y-%m-%d").to_string(),
        completions: Vec::new(),
    });
    next.next_id = next
        .next_id
        .checked_add(1)
        .ok_or_else(|| "Диапазон id привычек исчерпан".to_string())?;
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
    anchor: Option<String>,
    days: Option<i64>,
) -> Result<BoardResponse, String> {
    let anchor_date = resolve_anchor(anchor)?;
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Состояние данных повреждено".to_string())?;
    let next = add_habit_to_store(&store, &name)?;
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
            add_habit,
            delete_habit,
            toggle_day
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
            }],
        }
    }

    #[test]
    fn add_habit_to_store_does_not_mutate_source() {
        let store = sample_store();
        let next = add_habit_to_store(&store, "Бег").unwrap();

        assert_eq!(store.habits.len(), 1);
        assert_eq!(store.next_id, 2);
        assert_eq!(next.habits.len(), 2);
        assert_eq!(next.next_id, 3);
        assert_eq!(next.habits[1].name, "Бег");
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
            }],
        };

        let migrated = normalize_store(legacy).unwrap();
        assert_eq!(migrated.version, SCHEMA_VERSION);
        assert_eq!(migrated.next_id, 8);
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
        assert!(add_habit_to_store(&store, &long_name).is_err());
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
                })
                .collect(),
        };

        let normalized = normalize_store(raw).unwrap();
        let ids: Vec<u32> = normalized.habits.iter().map(|h| h.id).collect();
        assert_eq!(ids, vec![1, 2, 3]);
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
}
