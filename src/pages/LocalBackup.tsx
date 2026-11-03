import { useState } from "react";
import { Button, ErrorMessage, Field, Header } from "../ui/components.tsx";
import { useApp } from "../ui/context.tsx";
import {
  decodeBackup,
  importLocalBackup,
  type BackupData,
} from "../storage/archive.ts";
import {
  readRestoreTarget,
  type RestoreTarget,
} from "../storage/repository.ts";

export function LocalBackupPanel({
  onRestored,
  onBusyChange,
}: {
  onRestored: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<{
      data: BackupData;
      target: RestoreTarget;
    } | null>(null),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function perform(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    onBusyChange?.(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div className="service-panel">
      <p className="section-note">
        支持厘序完整备份包和原 JSON
        备份。先预览再替换本机内容；远端账本不会被改写。
      </p>
      <div className="form-surface service-form">
        <Field label="完整备份文件">
          <input
            type="file"
            accept="application/zip,application/json,.zip,.json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              setAccepted(false);
              if (file)
                void perform(async () => {
                  if (file.size > 64 * 1024 * 1024)
                    throw Error("备份文件超过 64 MB");
                  const target = await readRestoreTarget("personal");
                  const data = await decodeBackup(
                    new Uint8Array(await file.arrayBuffer()),
                  );
                  setPreview({ data, target });
                });
            }}
          />
        </Field>
      </div>
      {preview && (
        <>
          <section className="settings-section">
            <h2>备份内容</h2>
            <div className="settings-surface">
              <div className="setting-row">
                <span>{preview.data.book!.name}</span>
                <small>{preview.data.book!.currency}</small>
              </div>
              <div className="setting-row">
                <span>账户与交易</span>
                <small>
                  {preview.data.book!.accounts.length} 个账户 ·{" "}
                  {preview.data.book!.entries.length} 笔
                </small>
              </div>
            </div>
          </section>
          {preview.target.book && (
            <label className="restore-confirm">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                替换本机“{preview.target.book.name}
                ”及其待上传操作；替换前保留一份副本。
              </span>
            </label>
          )}
          <p className="section-note">
            恢复后可以离线使用。若要继续同步，需要连接远端并核对差异，不会直接重放文件中的旧上传请求。
          </p>
          <div className="service-actions">
            <Button
              disabled={busy || (!!preview.target.book && !accepted)}
              onClick={() =>
                void perform(async () => {
                  await importLocalBackup(
                    "personal",
                    preview.data,
                    preview.target.token,
                  );
                  onRestored();
                })
              }
            >
              {busy ? "正在恢复…" : "恢复到本机并打开"}
            </Button>
          </div>
        </>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}
export function LocalBackup() {
  const app = useApp();
  return (
    <>
      <Header title="从备份文件恢复" back />
      <main className="page-content settings-page">
        <LocalBackupPanel
          onRestored={app.restored}
          onBusyChange={app.setDirty}
        />
      </main>
    </>
  );
}
