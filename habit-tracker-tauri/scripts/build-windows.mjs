import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(projectRoot, 'build', 'windows')
const cliPath = join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const releaseExe = join(projectRoot, 'src-tauri', 'target', 'release', 'habit-tracker-tauri.exe')

// Собираем release-билд без/installer-бандла: для MSI/NSIS нужны WiX/NSIS,
// а отдельная папка должна содержать готовый portable .exe.
const build = spawnSync(process.execPath, [cliPath, 'build', '--no-bundle'], {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

if (!existsSync(releaseExe)) {
  console.error(`Не найден сборенный exe: ${releaseExe}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })
copyFileSync(releaseExe, join(outputDir, 'PerdangaGoodHabits.exe'))

writeFileSync(
  join(outputDir, 'README.txt'),
  [
    'PerdangaGoodHabits — Windows build',
    '',
    'Запуск: PerdangaGoodHabits.exe',
    'Данные сохраняются в habits.json в app data директории Tauri.',
    'Для отображения интерфейса требуется WebView2 (обычно уже установлен).',
    '',
    `Собрано: ${new Date().toISOString()}`,
    '',
  ].join('\n'),
  'utf8',
)

console.log(`Windows-билд скопирован в: ${outputDir}`)
