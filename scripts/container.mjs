import { spawnSync } from "node:child_process";
import { containerImage } from "./container-version.mjs";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: npm run container -- <compose command> [options]");
  process.exit(1);
}
const result = spawnSync("docker", ["compose", ...args], {
  stdio: "inherit",
  env: { ...process.env, FINE_LEDGER_IMAGE: containerImage() },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
