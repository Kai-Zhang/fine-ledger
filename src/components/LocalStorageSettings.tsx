import { useEffect, useState } from "react";
import { databases } from "../storage/repository.ts";
import { useApp } from "../ui/context.tsx";
import { Button, Dialog, Field, SettingRow } from "../ui/components.tsx";

export function LocalStorageSettings() {
  const app = useApp();
  const [usage, setUsage] = useState("");
  useEffect(() => {
    let active = true;
    void navigator.storage
      ?.estimate()
      .then((value) => {
        if (active && value.usage !== undefined)
          setUsage(`${(value.usage / 1048576).toFixed(1)} MB`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <SettingRow
      icon="HardDrive"
      label="本机存储与修改历史"
      value={usage}
      onClick={() => app.open(<HistoryPolicy />)}
    />
  );
}

function HistoryPolicy() {
  const app = useApp();
  const [days, setDays] = useState<number>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void databases[app.mode].state
      .get("revision-retention")
      .then((value) => {
        if (active)
          setDays((value as { days?: number } | undefined)?.days ?? 30);
      })
      .catch(() => {
        if (active) setDays(30);
      });
    return () => {
      active = false;
    };
  }, [app.mode]);
  return (
    <Dialog title="修改历史" onClose={app.close}>
      <div className="dialog-body">
        <Field label="已同步的修改历史">
          <select
            disabled={days === undefined || busy}
            value={days ?? 30}
            onChange={async (event) => {
              const next = Number(event.target.value);
              setBusy(true);
              try {
                await databases[app.mode].state.put(
                  { days: next, minimum: 1000 },
                  "revision-retention",
                );
                setDays(next);
              } catch {
                app.toast("保存失败，请重试");
              } finally {
                setBusy(false);
              }
            }}
          >
            <option value={30}>保留最近 30 天</option>
            <option value={90}>保留最近 90 天</option>
            <option value={365}>保留最近一年</option>
            <option value={0}>全部保留</option>
          </select>
        </Field>
        <p className="section-note">
          同时至少保留最近 1,000
          次修改。只有本机与远端完全同步后才整理历史；交易记录、待同步修改和冲突内容不会被删除。
        </p>
        <p className="section-note">
          需要长期留存修改过程时，请先导出完整备份。当前账本备份体积较小，不包含旧修改历史与旧恢复副本。
        </p>
        <Button disabled={busy} onClick={app.close}>
          完成
        </Button>
      </div>
    </Dialog>
  );
}
