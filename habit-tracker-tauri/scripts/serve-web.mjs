import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
const port = Number(process.env.PORT || 5173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(root + sep);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname.endsWith("/")) {
      pathname += "index.html";
    }

    const relative = normalize(pathname).replace(/^([/\\])+/, "");
    const filePath = resolve(root, relative);
    if (!isInsideRoot(filePath)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    const target = info?.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(target);

    res.writeHead(200, {
      "Content-Type": contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (_err) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`PerdangaGoodHabits (web): http://localhost:${port}`);
});
