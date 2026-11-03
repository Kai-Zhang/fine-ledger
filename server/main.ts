import { readFile, mkdir } from "node:fs/promises";
import { loadConfig } from "./config.ts";
import { createService, acquireLock } from "./app.ts";
import { restoreBackup } from "./backup.ts";
import { Store } from "./store.ts";
import { setPassword } from "./auth.ts";

const config = loadConfig();
const command = process.argv[2] || "serve";
try {
  process.umask(0o077);
  if (command === "serve") {
    const { app } = await createService(config);
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void app.close();
      });
    try {
      await app.listen({ host: config.host, port: config.port });
      console.log(`厘序同步服务已启动，公开来源：${config.publicOrigin}`);
    } catch (e) {
      await app.close();
      throw e;
    }
  } else {
    if (!["reset-password", "restore"].includes(command))
      throw new Error("命令为 serve、reset-password 或 restore <备份ID>");
    if (!config.passwordFile)
      throw new Error("需要 FINE_LEDGER_PASSWORD_FILE 指定新访问密码文件");
    const password = (await readFile(config.passwordFile, "utf8")).replace(
      /\r?\n$/,
      "",
    );
    // Validate before restoring anything.
    if (password.length < 12 || password.length > 1024)
      throw new Error("密码长度需为 12–1024 个字符");
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const unlock = acquireLock(config);
    try {
      if (command === "restore")
        await restoreBackup(config, process.argv[3] || "");
      const store = new Store(config);
      try {
        await setPassword(store, password);
      } finally {
        store.close();
      }
      console.log(
        command === "restore"
          ? "备份恢复完成，已更换恢复代次并撤销全部设备会话"
          : "访问密码已重置，全部设备需重新登录",
      );
    } finally {
      unlock();
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
