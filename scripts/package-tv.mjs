// Prépare les applications TV (LG webOS, Samsung Tizen) à partir de la version web (app/dist-web).
// Empaquetage final : `ares-package tv/build/webos` (webOS CLI) et `tizen package -t wgt -- tv/build/tizen` (Tizen Studio).
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "app", "dist-web");
const icons = join(root, "app", "src-tauri", "icons");
if (!existsSync(join(web, "index.html"))) {
  console.error("Version web absente : lancez d'abord `npm run build:web` dans app/.");
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(root, "app", "package.json"), "utf8")).version;

for (const target of ["webos", "tizen"]) {
  const out = join(root, "tv", "build", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(web, out, { recursive: true });
  cpSync(join(icons, "128x128.png"), join(out, "icon.png"));
  if (target === "webos") {
    cpSync(join(icons, "128x128@2x.png"), join(out, "largeIcon.png"));
    const info = JSON.parse(readFileSync(join(root, "tv", "webos", "appinfo.json"), "utf8"));
    writeFileSync(join(out, "appinfo.json"), JSON.stringify({ ...info, version }, null, 2));
  } else {
    const xml = readFileSync(join(root, "tv", "tizen", "config.xml"), "utf8").replace(/version="[\d.]+"/, `version="${version}"`);
    writeFileSync(join(out, "config.xml"), xml);
  }
  console.log(`TV ${target} prête : ${out}`);
}
