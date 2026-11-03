import { readFileSync } from "node:fs";

// package.json is the version source for the app build and container tooling.
export const appVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function containerImage(env = process.env) {
  return env.FINE_LEDGER_IMAGE || `fine-ledger:${appVersion}`;
}
