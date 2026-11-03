import { createHash } from "node:crypto";
import { canonical } from "../src/sync/protocol.ts";
export * from "../src/sync/protocol.ts";
export function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
