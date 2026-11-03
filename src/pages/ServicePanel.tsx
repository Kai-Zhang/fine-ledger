import { SyncEngine, requestSync, syncMessage } from "../sync/engine.ts";
import type { LocalSyncView } from "../sync/local-view.ts";
import { decodeBackup } from "../storage/archive.ts";
import { SyncReview } from "./SyncReview.tsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Field,
  Toggle,
  ErrorMessage,
  SettingRow,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { SwipeActionRow } from "../ui/SwipeActionRow.tsx";
import {
  clearServiceView,
  readServiceView,
  saveServiceView,
} from "../sync/service-cache.ts";
import type { AppContextValue } from "../ui/context.tsx";
import {
  databases,
  readRestoreTarget,
  restoreRemoteBook,
  type RestoreTarget,
} from "../storage/repository.ts";
import { verifySnapshot, type Snapshot } from "../sync/snapshot.ts";
import {
  serviceRequest,
  type ServicePage,
  type RuntimeSettings,
  type ServiceSession,
  type ServiceDevice,
  type ServiceBackup,
} from "../sync/service.ts";
import type { Book } from "../domain/types.ts";
import { localInput } from "../domain/dates.ts";

type Confirm = AppContextValue["confirm"];
export const serviceTitles: Record<ServicePage, string> = {
  overview: "同步与设备",
  review: "核对同步差异",
  publish: "建立远端账本",
  restore: "从远端恢复",
  backups: "数据备份",
  policy: "备份计划",
  devices: "已授权设备",
  device: "设备详情",
  service: "服务设置",
  import: "导入远端账本",
};
function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-surface">{children}</div>
      {note && <p className="section-note">{note}</p>}
    </section>
  );
}
function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <div className="setting-row service-info">
      {icon && <Icon name={icon} />}
      <span>{label}</span>
      <small>{value}</small>
    </div>
  );
}
const when = (value: string | number) => new Date(value).toLocaleString();

export function ServicePanel({
  localSync,
  previewOnly = false,
  editingBackups = false,
  onBackupAvailabilityChange,
  onboarding = false,
  page = "overview",
  deviceId,
  onNavigate,
  onRestored,
  onDeviceRevoked,
  onSyncReviewed,
  onBusyChange,
  onDirtyChange,
  confirm,
  refreshKey = 0,
}: {
  localSync: LocalSyncView;
  previewOnly?: boolean;
  editingBackups?: boolean;
  onBackupAvailabilityChange?: (available: boolean) => void;
  onboarding?: boolean;
  page?: ServicePage;
  deviceId?: string;
  onNavigate?: (page: ServicePage, id?: string) => void;
  onRestored?: () => void;
  onDeviceRevoked?: () => void;
  onSyncReviewed?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  confirm?: Confirm;
  refreshKey?: number;
}) {
  const [cached] = useState(() => readServiceView(location.origin));
  const [password, setPassword] = useState(""),
    [deviceName, setDeviceName] = useState("我的设备");
  const [auth, setAuth] = useState<ServiceSession | null>(cached?.auth || null),
    [settings, setSettings] = useState<RuntimeSettings | null>(
      cached?.settings || null,
    );
  const [authRequired, setAuthRequired] = useState(false);
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [backups, setBackups] = useState<ServiceBackup[]>(
      cached?.backups || [],
    ),
    [devices, setDevices] = useState<ServiceDevice[]>(cached?.devices || []);
  const [loading, setLoading] = useState(!cached),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{
      snapshot: Snapshot;
      target: RestoreTarget;
    } | null>(null),
    [replaceAccepted, setReplaceAccepted] = useState(false);
  const [imported, setImported] = useState<Book | null>(null),
    [operationId, setOperationId] = useState("");
  const [editedDeviceName, setEditedDeviceName] = useState(
    cached?.devices.find((d) => d.id === deviceId)?.name || "",
  );
  const [openBackup, setOpenBackup] = useState<string | null>(null),
    [deletedBackup, setDeletedBackup] = useState<ServiceBackup | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  useEffect(() => {
    if (page === "backups" && !previewOnly)
      onBackupAvailabilityChange?.(!!auth && backups.length > 0);
  }, [page, previewOnly, !!auth, backups.length, onBackupAvailabilityChange]);
  useEffect(() => setOpenBackup(null), [editingBackups]);
  const savedSettings = useRef(cached ? JSON.stringify(cached.settings) : "");
  const activeDevices = devices.filter((d) => !d.revoked && d.connected !== 0),
    device = activeDevices.find((d) => d.id === deviceId);
  const {
    baseline,
    status: syncStatus,
    issue: syncIssue,
    book: localBook,
    pending,
  } = localSync;
  useEffect(() => {
    if (syncStatus?.phase === "auth-required") {
      if (!previewOnly) clearServiceView(location.origin);
      setAuth(null);
      setSettings(null);
      setPreview(null);
      setAuthRequired(true);
    }
  }, [syncStatus?.phase, previewOnly]);
  const dirty =
    !!password ||
    ((page === "service" || page === "policy") &&
      !!settings &&
      JSON.stringify(settings) !== savedSettings.current) ||
    (page === "device" && !!device && editedDeviceName !== device.name) ||
    !!imported;
  const dirtyState = useRef(dirty);
  dirtyState.current = dirty;
  const callbacks = useRef({ onBusyChange, onDirtyChange });
  callbacks.current = { onBusyChange, onDirtyChange };
  useEffect(() => {
    if (!previewOnly)
      callbacks.current.onBusyChange?.(busy || (loading && !auth));
  }, [busy, loading, !!auth, previewOnly]);
  useEffect(() => {
    if (!previewOnly) callbacks.current.onDirtyChange?.(dirty || busy);
  }, [dirty, busy, previewOnly]);
  useEffect(
    () => () => {
      if (!previewOnly) {
        callbacks.current.onBusyChange?.(false);
        callbacks.current.onDirtyChange?.(false);
      }
    },
    [previewOnly],
  );
  useEffect(() => {
    if (!deletedBackup) return;
    const timer = setTimeout(() => setDeletedBackup(null), 10000);
    return () => clearTimeout(timer);
  }, [deletedBackup]);
  useEffect(() => {
    if (!openBackup) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.(".swipe-action-row"))
        setOpenBackup(null);
    };
    const scroll = () => setOpenBackup(null);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [openBackup]);
  async function api(
    path: string,
    method = "GET",
    data?: unknown,
    signal?: AbortSignal,
  ) {
    try {
      return await serviceRequest(path, {
        method,
        data,
        csrf: auth?.csrf,
        signal,
      });
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        clearServiceView(location.origin);
        setAuthRequired(true);
        setAuth(null);
        setSettings(null);
        setPreview(null);
      }
      throw e;
    }
  }
  async function readPreview(current: ServiceSession, signal?: AbortSignal) {
    if (!current.ledger) throw Error("远端还没有账本");
    setPreview(null);
    setReplaceAccepted(false);
    const target = await readRestoreTarget("personal");
    const snapshot = await verifySnapshot(
      await api("snapshot", "GET", undefined, signal),
      { ledgerId: current.ledger.id, serverEpoch: current.serverEpoch },
    );
    if (!signal?.aborted) setPreview({ snapshot, target });
  }
  async function refresh(signal?: AbortSignal) {
    const current = (await api(
      "session",
      "GET",
      undefined,
      signal,
    )) as ServiceSession;
    if (current.protocol !== "fine-ledger-sync-v1")
      throw Error("服务协议不兼容，请检查部署入口");
    const [config, list, deviceList] = await Promise.all([
      api("settings", "GET", undefined, signal),
      api("backups", "GET", undefined, signal),
      api("devices", "GET", undefined, signal),
    ]);
    if (signal?.aborted) return;
    setConnectionUnavailable(false);
    setAuth(current);
    setAuthRequired(false);
    if (!(await databases.personal.state.get("sync-enabled"))) {
      await databases.personal.state.put(true, "sync-enabled");
      requestSync();
    }
    if (signal?.aborted) return;
    saveServiceView(location.origin, {
      auth: current,
      settings: config.settings,
      backups: list.backups,
      devices: deviceList.devices,
    });
    // A warm page is editable while its background read is in flight.
    // Do not replace an input that the user has already started changing.
    if (!dirtyState.current) {
      setSettings(config.settings);
      savedSettings.current = JSON.stringify(config.settings);
      setEditedDeviceName(
        deviceList.devices.find((d: ServiceDevice) => d.id === deviceId)
          ?.name || "",
      );
    }
    setBackups(list.backups);
    setDevices(deviceList.devices);
    if ((onboarding || page === "restore") && current.ledger)
      await readPreview(current, signal);
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (previewOnly) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void refresh(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted && e.status !== 401) {
          setConnectionUnavailable(true);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, previewOnly]);
  useEffect(() => {
    if (
      previewOnly ||
      (auth && !connectionUnavailable) ||
      authRequired ||
      !baseline ||
      !error ||
      loading ||
      busy ||
      syncStatus?.phase !== "idle"
    )
      return;
    const controller = new AbortController();
    void refresh(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setError("");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [
    previewOnly,
    auth,
    connectionUnavailable,
    authRequired,
    baseline,
    error,
    loading,
    busy,
    syncStatus?.phase,
    syncStatus?.lastSuccess,
  ]);
  const navigate = (next: ServicePage, id?: string) => onNavigate?.(next, id);
  async function saveSettings() {
    const result = await api("settings", "PATCH", settings);
    setSettings(result.settings);
    savedSettings.current = JSON.stringify(result.settings);
    setAuth((a) =>
      a ? { ...a, serviceName: result.settings.serviceName } : a,
    );
    if (auth)
      saveServiceView(location.origin, {
        auth: { ...auth, serviceName: result.settings.serviceName },
        settings: result.settings,
        backups,
        devices,
      });
    setMessage("设置已保存");
  }
  async function disconnect() {
    if (
      !confirm ||
      !(await confirm({
        title: "断开远端连接？",
        message:
          "这台设备将需要重新输入口令才能访问远端。已下载的本机账本和未上传修改会保留，仍可离线使用。",
        label: "断开连接",
        danger: true,
      }))
    )
      return;
    await api("session", "DELETE", {});
    clearServiceView(location.origin);
    setAuth(null);
    setSettings(null);
    setPassword("");
    setPreview(null);
    await databases.personal.state.put(false, "sync-enabled");
    await databases.personal.state.put(
      { phase: "unlinked", message: "已断开远端连接，本机账本保留" },
      "sync-status",
    );
    setMessage("已断开远端连接，本机账本保留");
  }
  async function updateBackups() {
    const result = await api("backups");
    setBackups(result.backups);
    if (auth && settings)
      saveServiceView(location.origin, {
        auth,
        settings,
        devices,
        backups: result.backups,
      });
  }
  const restoreContent = auth?.ledger ? (
    <>
      {preview ? (
        <>
          <Section title="远端账本">
            <InfoRow
              icon="BookOpen"
              label={preview.snapshot.book.name}
              value={preview.snapshot.book.currency}
            />
            <InfoRow
              label="账户"
              value={`${preview.snapshot.book.accounts.length} 个`}
            />
            <InfoRow
              label="交易"
              value={`${preview.snapshot.book.entries.length} 笔`}
            />
          </Section>
          <p className="section-note">
            下载后可在账户、交易和报表中使用。远端账本保持原样。
          </p>
          {preview.target.book && (
            <section className="settings-section">
              <h2>替换本机副本</h2>
              <div className="settings-surface service-confirm">
                <p>
                  本机“{preview.target.book.name}”有{" "}
                  {preview.target.book.entries} 笔记录
                  {preview.target.pending > 0
                    ? `，另有 ${preview.target.pending} 条本机修改尚未上传`
                    : ""}
                  。
                </p>
                <p>
                  恢复会替换本机内容，不合并这些修改。替换前保留一份副本，可随完整备份导出。
                </p>
                <label className="restore-confirm">
                  <input
                    type="checkbox"
                    checked={replaceAccepted}
                    disabled={busy}
                    onChange={(e) => setReplaceAccepted(e.target.checked)}
                  />
                  <span>我确认用远端账本替换本机副本</span>
                </label>
              </div>
            </section>
          )}
          <div className="service-actions">
            <Button
              disabled={busy || (!!preview.target.book && !replaceAccepted)}
              onClick={() =>
                void perform(async () => {
                  await restoreRemoteBook("personal", preview.snapshot, {
                    origin: location.origin,
                    expectedTarget: preview.target.token,
                    ledgerId: auth.ledger!.id,
                    serverEpoch: auth.serverEpoch,
                  });
                  setPreview(null);
                  onRestored?.();
                })
              }
            >
              {busy
                ? "正在保存…"
                : preview.target.book
                  ? "确认恢复并打开"
                  : "下载并开始记账"}
            </Button>
          </div>
        </>
      ) : (
        <p className="section-note">正在读取远端账本。</p>
      )}
      <div className="service-secondary">
        <Button
          variant="plain"
          disabled={busy}
          onClick={() => void perform(() => readPreview(auth))}
        >
          重新读取
        </Button>
      </div>
    </>
  ) : (
    <p className="section-note">
      远端还没有账本。可以先创建本机账本，或由管理者导入已有账本。
    </p>
  );
  return (
    <div className="service-panel" aria-busy={loading}>
      {loading && !auth && !authRequired ? (
        <p className="section-note" role="status">
          正在检查连接…
        </p>
      ) : !auth && baseline && !authRequired && !!error ? (
        <>
          <Section title="本机同步状态">
            <InfoRow icon="Cloud" label="远端服务" value="暂时无法连接" />
            <InfoRow label="本机账本" value={localBook?.name || "已保留"} />
            <InfoRow label="待同步操作" value={`${pending || 0} 条`} />
          </Section>
          <p className="section-note">
            本机账本仍可正常使用。连接恢复后会自动续传，无需重新填写口令。
          </p>
        </>
      ) : !auth ? (
        <>
          <p className="section-note">
            {authRequired &&
              "设备授权已失效，本机账本和待同步内容仍保留。请重新验证口令。"}
            使用当前网页的账本服务，无需填写地址。访问口令用于授权这台设备。
          </p>
          <form
            className="form-surface service-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await api("session", "POST", { password, deviceName });
                setPassword("");
                await refresh();
                requestSync(true);
              });
            }}
          >
            <Field label="设备名称">
              <input
                required
                maxLength={100}
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                autoComplete="nickname"
              />
            </Field>
            <Field label="访问口令">
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <div className="service-actions">
              <Button disabled={busy}>
                {busy
                  ? "正在验证…"
                  : onboarding
                    ? "验证并查看账本"
                    : "连接远端"}
              </Button>
            </div>
          </form>
        </>
      ) : onboarding || page === "restore" ? (
        restoreContent
      ) : (
        <>
          {page === "overview" && (
            <>
              <Section title="当前连接">
                <InfoRow
                  icon="Cloud"
                  label="远端服务"
                  value={
                    connectionUnavailable || syncStatus?.phase === "offline"
                      ? "暂时无法连接"
                      : "已连接"
                  }
                />
                <InfoRow label="当前设备" value={auth.deviceName} />
                <InfoRow
                  label="同步状态"
                  value={
                    syncStatus?.phase === "idle" && pending
                      ? `${pending} 条待同步`
                      : syncMessage(syncStatus?.phase || "unlinked")
                  }
                />
              </Section>
              <p className="section-note">
                联网时自动同步，无法连接时仍可在本机记账。
              </p>
              {baseline && (
                <dl className="section-note service-sync-summary">
                  <dt>最近同步</dt>
                  <dd>
                    <time
                      dateTime={syncStatus?.lastSuccess || baseline.restoredAt}
                    >
                      {localInput(
                        syncStatus?.lastSuccess || baseline.restoredAt,
                      ).replace("T", " ")}
                    </time>
                  </dd>
                  <dt>待上传</dt>
                  <dd>{pending || 0} 条本机修改</dd>
                </dl>
              )}
              {syncStatus?.message && (
                <p className="section-note">{syncStatus.message}</p>
              )}
              {syncIssue && (
                <Section title="需要核对">
                  <SettingRow
                    icon="AlertCircle"
                    label={
                      syncIssue.kind === "recovery"
                        ? "恢复后核对"
                        : "处理同步差异"
                    }
                    value={`${syncIssue.items.length} 项`}
                    onClick={() => navigate("review")}
                  />
                </Section>
              )}
              <Section title="账本">
                {baseline && (
                  <SettingRow
                    icon="RotateCcw"
                    label="立即同步"
                    disabled={busy || syncStatus?.phase === "syncing"}
                    onClick={() =>
                      void perform(() => new SyncEngine().run(true))
                    }
                  />
                )}
                {!auth.ledger && localBook && (
                  <SettingRow
                    icon="Cloud"
                    label="使用本机账本建立远端"
                    onClick={() => navigate("publish")}
                  />
                )}

                <SettingRow
                  icon="Download"
                  label={auth.ledger ? "从远端恢复" : "导入远端账本"}
                  detail={auth.ledger?.name || "远端尚无账本"}
                  disabled={busy}
                  onClick={() => navigate(auth.ledger ? "restore" : "import")}
                />
              </Section>
              <Section title="服务">
                <SettingRow
                  icon="Settings"
                  label="服务设置"
                  onClick={() => navigate("service")}
                />
                <SettingRow
                  icon="Archive"
                  label="数据备份"
                  value={backups.length ? `${backups.length} 份` : "暂无备份"}
                  onClick={() => navigate("backups")}
                />
                <SettingRow
                  icon="Smartphone"
                  label="已授权设备"
                  value={`${activeDevices.length} 台`}
                  onClick={() => navigate("devices")}
                />
              </Section>
              <Section
                title="连接管理"
                note="断开连接不会删除或锁定已经下载到这台设备的账本。"
              >
                <SettingRow
                  icon="CloudOff"
                  label="断开远端连接"
                  danger
                  disabled={busy}
                  onClick={() => void perform(disconnect)}
                />
              </Section>
            </>
          )}
          {page === "review" &&
            (syncIssue ? (
              <SyncReview
                issue={syncIssue}
                onResolved={() => onSyncReviewed?.()}
                onBusyChange={onBusyChange || (() => {})}
              />
            ) : (
              <p className="section-note">没有需要核对的同步差异。</p>
            ))}
          {page === "publish" && localBook && (
            <>
              <Section title="本机账本">
                <InfoRow label={localBook.name} value={localBook.currency} />
                <InfoRow
                  label="账户与交易"
                  value={`${localBook.accounts.length} 个账户 · ${localBook.entries.length} 笔`}
                />
              </Section>
              <p className="section-note">
                将这份本机账本作为远端的初始版本。建立后，其余设备可通过同一网页连接。远端已有账本时不会覆盖。
              </p>
              <div className="service-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await new SyncEngine().publish();
                      await refresh();
                      onSyncReviewed?.();
                    })
                  }
                >
                  {busy ? "正在建立…" : "建立远端并启用同步"}
                </Button>
              </div>
            </>
          )}
          {page === "service" && settings && (
            <>
              <Section title="连接信息">
                <InfoRow label="服务地址" value={location.origin} />
              </Section>
              <section className="settings-section">
                <h2>服务名称</h2>
                <form
                  className="form-surface service-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(saveSettings);
                  }}
                >
                  <Field label="名称">
                    <input
                      required
                      maxLength={100}
                      value={settings.serviceName}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          serviceName: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <div className="service-actions">
                    <Button disabled={busy || !dirty}>保存</Button>
                  </div>
                </form>
              </section>
            </>
          )}
          {page === "backups" && (
            <>
              <Section
                title="备份设置"
                note="备份保存在部署时指定的本地存储中。"
              >
                <SettingRow
                  icon="Clock3"
                  label="备份计划"
                  value={
                    settings?.autoBackup
                      ? `每 ${settings.backupIntervalMinutes} 分钟`
                      : "自动备份关闭"
                  }
                  onClick={() => navigate("policy")}
                />
              </Section>
              <Section title="已有备份">
                {!backups.length ? (
                  <p className="service-empty">暂无备份</p>
                ) : (
                  backups.slice(0, 20).map((b) => (
                    <SwipeActionRow
                      key={b.id}
                      label={when(b.createdAt)}
                      detail={
                        b.kind === "automatic"
                          ? "自动"
                          : b.kind === "before-restore"
                            ? "恢复前"
                            : "手动"
                      }
                      open={openBackup === b.id}
                      editing={editingBackups}
                      disabled={busy}
                      onOpenChange={(open) => setOpenBackup(open ? b.id : null)}
                      onDelete={() =>
                        void perform(async () => {
                          await api("backups/" + b.id, "DELETE", {});
                          setOpenBackup(null);
                          setBackups((rows) =>
                            rows.filter((row) => row.id !== b.id),
                          );
                          setDeletedBackup(b);
                          await updateBackups();
                        })
                      }
                    />
                  ))
                )}
              </Section>
              <div className="service-actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      setCreatingBackup(true);
                      try {
                        await api("backups", "POST", {});
                        await updateBackups();
                        setMessage("备份已创建");
                      } finally {
                        setCreatingBackup(false);
                      }
                    })
                  }
                >
                  {creatingBackup ? "正在备份…" : "创建备份"}
                </Button>
              </div>
              <p className="section-note">
                左滑可删除备份，删除后可立即撤销。文件将在 24 小时后清理。
              </p>
              <p className="section-note">
                从服务备份恢复由管理者完成。恢复后需要重新连接，并核对本机内容。
              </p>
            </>
          )}
          {page === "policy" && settings && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(saveSettings);
              }}
            >
              <Section title="自动备份">
                <Toggle
                  checked={settings.autoBackup}
                  onChange={() =>
                    setSettings({
                      ...settings,
                      autoBackup: !settings.autoBackup,
                    })
                  }
                  label="启用自动备份"
                />
              </Section>
              <section className="settings-section">
                <h2>时间与保留策略</h2>
                <div className="form-surface service-form">
                  {(
                    [
                      ["backupIntervalMinutes", "备份间隔（分钟）", 5, 1440],
                      ["recentHours", "近期版本保留（小时）", 1, 168],
                      ["dailyDays", "每日版本保留（天）", 1, 90],
                      ["weeklyWeeks", "每周版本保留（周）", 1, 52],
                      ["manualKeep", "手动及恢复前备份保留数", 1, 100],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <Field key={key} label={label}>
                      <input
                        required
                        type="number"
                        min={min}
                        max={max}
                        value={settings[key]}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </section>
              <p className="section-note">
                自动备份只在账本有变化且达到间隔时创建。关闭后仍可手动备份。
              </p>
              <div className="service-actions">
                <Button disabled={busy || !dirty}>保存备份计划</Button>
              </div>
            </form>
          )}
          {page === "devices" && (
            <Section
              title="已授权设备"
              note="撤销后，该设备下次访问远端时需要重新输入口令；其本机副本仍保留。"
            >
              {activeDevices.map((d) => (
                <SettingRow
                  key={d.id}
                  icon="Smartphone"
                  label={d.name}
                  detail={
                    d.id === auth.deviceId
                      ? "当前设备"
                      : `最近访问 ${when(d.lastSeen)}`
                  }
                  onClick={() => navigate("device", d.id)}
                />
              ))}
            </Section>
          )}
          {page === "device" &&
            (device ? (
              <>
                <Section title="设备信息">
                  <InfoRow
                    label="状态"
                    value={device.id === auth.deviceId ? "当前设备" : "已授权"}
                  />
                  <InfoRow label="最近访问" value={when(device.lastSeen)} />
                </Section>
                <section className="settings-section">
                  <h2>设备名称</h2>
                  <form
                    className="form-surface service-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        await api("devices/" + device.id, "PATCH", {
                          name: editedDeviceName,
                        });
                        await refresh();
                        setMessage("设备名称已保存");
                      });
                    }}
                  >
                    <Field label="名称">
                      <input
                        required
                        maxLength={100}
                        value={editedDeviceName}
                        onChange={(e) => setEditedDeviceName(e.target.value)}
                      />
                    </Field>
                    <div className="service-actions">
                      <Button disabled={busy || !dirty}>保存</Button>
                    </div>
                  </form>
                </section>
                {device.id !== auth.deviceId && (
                  <Section title="授权管理">
                    <SettingRow
                      icon="CloudOff"
                      label="撤销设备授权"
                      danger
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          if (
                            !confirm ||
                            !(await confirm({
                              title: "撤销这台设备的授权？",
                              message: `“${device.name}”将无法继续访问远端，已下载的本机账本不会被远程删除。`,
                              label: "撤销授权",
                              danger: true,
                            }))
                          )
                            return;
                          await api("devices/" + device.id, "DELETE", {});
                          onDeviceRevoked?.();
                        })
                      }
                    />
                  </Section>
                )}
              </>
            ) : (
              <p className="section-note">这台设备已不在授权列表中。</p>
            ))}
          {page === "import" && (
            <>
              <p className="section-note">
                选择厘序完整备份，预览后建立远端账本。本机内容和原文件保留。
              </p>
              {auth.ledger ? (
                <p className="section-note">远端已经有账本，不能覆盖导入。</p>
              ) : (
                <>
                  <div className="form-surface service-form">
                    <Field label="完整备份文件">
                      <input
                        type="file"
                        accept="application/zip,application/json,.zip,.json"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          setImported(null);
                          if (file)
                            void perform(async () => {
                              if (file.size > 24 * 1024 * 1024)
                                throw Error("文件超过 24 MB，请由管理者导入");
                              const data = await decodeBackup(
                                new Uint8Array(await file.arrayBuffer()),
                              );
                              if (
                                data.format !== "fine-ledger-backup" ||
                                data.version !== 3 ||
                                ![3, 4].includes(data.book?.schema) ||
                                !Array.isArray(data.book.accounts) ||
                                !Array.isArray(data.book.entries)
                              )
                                throw Error("请选择当前厘序导出的完整备份");
                              setImported(data.book);
                              setOperationId(crypto.randomUUID());
                            });
                        }}
                      />
                    </Field>
                  </div>
                  {imported && (
                    <>
                      <Section title="导入预览">
                        <InfoRow
                          label={imported.name}
                          value={imported.currency}
                        />
                        <InfoRow
                          label="账户"
                          value={`${imported.accounts.length} 个`}
                        />
                        <InfoRow
                          label="交易"
                          value={`${imported.entries.length} 笔`}
                        />
                      </Section>
                      <div className="service-actions">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api("ledger/initialize", "POST", {
                                book: imported,
                                operationId,
                                serverEpoch: auth.serverEpoch,
                              });
                              setImported(null);
                              await refresh();
                              setMessage("远端账本已建立");
                            })
                          }
                        >
                          确认导入
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <div className="service-feedback">
          <ErrorMessage message={error} />
          <Button
            variant="plain"
            disabled={busy || loading}
            onClick={() => void perform(refresh)}
          >
            重新载入
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="section-note">
          {message}
        </p>
      )}
      {deletedBackup && !previewOnly && (
        <div className="backup-undo" role="status">
          <span>备份已删除</span>
          <Button
            variant="plain"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api(
                  "backups/" + deletedBackup.id + "/undo-delete",
                  "POST",
                  {},
                );
                setDeletedBackup(null);
                await updateBackups();
                setMessage("备份已恢复");
              })
            }
          >
            撤销
          </Button>
        </div>
      )}
    </div>
  );
}
