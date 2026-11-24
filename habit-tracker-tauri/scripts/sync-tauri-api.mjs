import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "@tauri-apps", "api");
const target = join(root, "src", "vendor", "tauri");

const files = [
  ["core.js", "core.js"],
  ["external/tslib/tslib.es6.js", "external/tslib/tslib.es6.js"],
  ["LICENSE-APACHE-2.0", "LICENSE-APACHE-2.0"],
  ["LICENSE-MIT", "LICENSE-MIT"],
];

for (const [from, to] of files) {
  const destination = join(target, to);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(source, from), destination);
}

const { version } = JSON.parse(
  await readFile(join(source, "package.json"), "utf8"),
);
await writeFile(
  join(target, "README.md"),
  [
    "# Vendored Tauri API",
    "",
    "These files are copied from `@tauri-apps/api` so the desktop app and the",
    "static GitHub Pages build can share the same frontend without a bundler.",
    "",
    `Version: ${version}`,
    "",
    "Refresh them with `npm install` followed by `npm run sync:tauri-api`.",
    "",
  ].join("\n"),
);

console.log(`Vendored @tauri-apps/api ${version} into src/vendor/tauri`);
