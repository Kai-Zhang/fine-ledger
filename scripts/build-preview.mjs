import {
  readFile,
  writeFile,
  mkdir,
  rename,
  readdir,
  cp,
  access,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function renderWorker(config) {
  return readFile(
    path.join(root, "scripts/templates/service-worker.js"),
    "utf8",
  ).then((template) =>
    template.replace("__FINE_LEDGER_SW_CONFIG__", JSON.stringify(config)),
  );
}
async function atomicWrite(filename, content) {
  const temporary = filename + `.build-${process.pid}`;
  await writeFile(temporary, content);
  await rename(temporary, filename);
}
async function tree(directory) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) =>
        entry.isDirectory()
          ? tree(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
  );
  return files.flat();
}
let inFlight;
export function buildPreview() {
  if (!inFlight)
    inFlight = compile().finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
async function compile() {
  const inputs = [
    ...(await tree("src")),
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    "scripts/templates/service-worker.js",
    "scripts/templates/bootstrap.js",
    "public/manifest.webmanifest",
    "public/icon.svg",
    "public/icon-192.png",
    "public/icon-512.png",
  ];
  const hash = createHash("sha256");
  for (const input of inputs) {
    hash.update(input);
    hash.update(await readFile(path.join(root, input)));
  }
  const pkg = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ),
    release = `${pkg.version}-${hash.digest("hex").slice(0, 16)}`,
    assetRoot = `/assets/${release}/`,
    directory = path.join(root, "public", assetRoot);
  let html, assets;
  try {
    const existing = JSON.parse(
      await readFile(path.join(directory, "build.json"), "utf8"),
    );
    await Promise.all(
      existing.assets.map((url) => access(path.join(root, "public", url))),
    );
    html = await readFile(path.join(directory, "index.html"), "utf8");
    assets = existing.assets;
  } catch {
    await build({
      root,
      base: assetRoot,
      define: { __APP_BUILD__: JSON.stringify(release) },
      logLevel: "warn",
    });
    const output = path.join(root, ".local/frontend-build");
    await mkdir(directory, { recursive: true });
    await cp(output, directory, { recursive: true });
    html = (
      await readFile(path.join(directory, "index.html"), "utf8")
    ).replaceAll("__BUILD_ID__", release);
    html = html.replace(
      '<script type="module"',
      `<script src="${assetRoot}bootstrap.js"></script>\n    <script type="module"`,
    );
    await atomicWrite(
      path.join(directory, "bootstrap.js"),
      await readFile(path.join(root, "scripts/templates/bootstrap.js"), "utf8"),
    );
    await atomicWrite(path.join(directory, "index.html"), html);
    const files = await readdir(directory);
    assets = [
      ...files.filter((f) => f !== "build.json").map((f) => assetRoot + f),
      "/manifest.webmanifest",
      "/icon.svg",
      "/icon-192.png",
      "/icon-512.png",
    ];
    await atomicWrite(
      path.join(directory, "build.json"),
      JSON.stringify({ release, assets }),
    );
  }
  const config = {
    release,
    root: "/",
    shell: assetRoot + "index.html",
    cachePrefix: "fine-ledger-shell-",
    assets,
  };
  const worker = await renderWorker(config);
  await atomicWrite(path.join(root, "public/index.html"), html);
  await atomicWrite(path.join(root, "public/sw.js"), worker);
  await atomicWrite(
    path.join(root, "public/release.json"),
    JSON.stringify({ release, assets }, null, 2) + "\n",
  );
  return { release, assets };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await buildPreview()));
