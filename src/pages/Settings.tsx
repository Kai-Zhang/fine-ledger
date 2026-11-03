import { encodeBackup } from "../storage/archive.ts";
import { syncMessage } from "../sync/engine.ts";
import { ServicePanel, serviceTitles } from "./ServicePanel.tsx";
import { readServiceView } from "../sync/service-cache.ts";
import { timeZones, deviceTimeZone } from "../domain/dates.ts";
import { useState, useRef, useEffect } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  SettingRow,
  BrandMark,
  Button,
  IconButton,
  Field,
  Dialog,
  Toggle,
  Empty,
  ErrorMessage,
} from "../ui/components.tsx";
import { Icon, icons } from "../ui/icons.tsx";
import { uid, type Category, type Book } from "../domain/types.ts";
import { sortedProjects } from "../domain/organization.ts";
import { currencies } from "../domain/money.ts";
import { exportBook } from "../storage/repository.ts";
export function Settings() {
  const app = useApp(),
    { book } = app,
    [info, setInfo] = useState(false);
  const { status: syncStatus, pending } = app.localSync;
  const locked =
    book.entries.length > 0 ||
    book.accounts.some((a) => BigInt(a.openingMinor) !== 0n);
  async function backup() {
    try {
      const data = await exportBook(app.mode),
        blob = new Blob([new Uint8Array(await encodeBackup(data))], {
          type: "application/zip",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `厘序-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      app.toast("备份已准备好");
    } catch {
      app.toast("导出失败，请重试");
    }
  }
  return (
    <>
      <Header title="设置" />
      <main className="page-content settings-page">
        <section className="settings-book">
          <BrandMark />
          <div>
            <strong>{book.name}</strong>
            <small>本机账本</small>
          </div>
          <IconButton
            name="Pencil"
            label="修改账本名称"
            onClick={() =>
              app.open(
                <NameEditor
                  title="账本名称"
                  initial={book.name}
                  onSave={(name) =>
                    app.save("修改账本名称", (b) => {
                      b.name = name;
                    })
                  }
                  onClose={app.close}
                />,
              )
            }
          />
        </section>
        <div className="settings-section">
          <h2>账本</h2>
          <div className="settings-surface">
            <SettingRow
              icon="Coins"
              label="主币种"
              value={book.currency}
              onClick={() =>
                app.open(
                  <Dialog title="主币种" onClose={app.close}>
                    <div className="dialog-body">
                      <p className="muted">
                        {locked
                          ? "已有金额记录，主币种已固定。账户仍可使用各自的币种。"
                          : "首笔金额记录保存后，主币种固定。"}
                      </p>
                      <Field label="主币种">
                        <select
                          value={book.currency}
                          disabled={locked}
                          onChange={(e) => {
                            const value = e.target.value;
                            void app
                              .save("设置主币种", (b) => {
                                if (
                                  b.entries.length ||
                                  b.accounts.some(
                                    (a) => BigInt(a.openingMinor) !== 0n,
                                  )
                                )
                                  throw Error("主币种已固定");
                                b.currency = value;
                              })
                              .then((ok) => {
                                if (ok) app.close();
                              });
                          }}
                        >
                          {currencies.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                      <div className="dialog-footer">
                        <Button onClick={app.close}>完成</Button>
                      </div>
                    </div>
                  </Dialog>,
                )
              }
            />
            <SettingRow
              icon="Clock3"
              label="时区"
              value={
                book.settings.timeZoneMode === "fixed"
                  ? book.timeZone
                  : `跟随系统 · ${book.timeZone}`
              }
              onClick={() => app.open(<TimeZoneEditor onClose={app.close} />)}
            />
            <SettingRow
              icon="Tag"
              label="消费与收入类目"
              onClick={() => app.go({ page: "categories" })}
            />
            <SettingRow
              icon="Folder"
              label="项目"
              value={book.projects.filter((p) => !p.archived).length.toString()}
              onClick={() => app.go({ page: "projects" })}
            />
            <SettingRow
              icon="Archive"
              label="已归档账户"
              onClick={() => app.go({ page: "archive" })}
            />
            <SettingRow
              icon="Trash2"
              label="最近删除"
              onClick={() => app.go({ page: "trash" })}
            />
          </div>
        </div>
        <div className="settings-section">
          <h2>数据</h2>
          <div className="settings-surface">
            <SettingRow
              icon="Cloud"
              label="远端账本与设备"
              value={
                syncStatus?.phase === "idle" && pending
                  ? `${pending} 条待同步`
                  : syncStatus
                    ? syncMessage(syncStatus.phase)
                    : "未连接"
              }
              onClick={() => app.go({ page: "sync" })}
            />
            <SettingRow
              icon="Download"
              label="从备份文件恢复"
              onClick={() => app.go({ page: "local-backup" })}
            />
            <SettingRow
              icon="Download"
              label="导出完整备份"
              onClick={() => void backup()}
            />
          </div>
        </div>
        <div className="settings-section">
          <h2>偏好</h2>
          <div className="settings-surface">
            <label className="setting-row">
              <Icon name="Monitor" />
              <span>外观</span>
              <select
                aria-label="外观"
                value={book.settings.theme}
                onChange={(e) => {
                  const value = e.target.value as Book["settings"]["theme"];
                  void app.save("设置外观", (b) => {
                    b.settings.theme = value;
                  });
                }}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <SettingRow
              icon="CircleHelp"
              label="添加到主屏幕"
              onClick={() => setInfo(true)}
            />
          </div>
        </div>
        <p className="app-version">厘序 · {__APP_BUILD__}</p>
      </main>
      {info && (
        <Dialog title="添加到主屏幕" onClose={() => setInfo(false)}>
          <div className="dialog-body">
            <p>
              在 iPhone Safari
              打开当前地址，轻点分享按钮，选择「添加到主屏幕」。
            </p>
            <p className="muted">
              首次打开后，已保存的账本可以离线查看与记账。
            </p>
            <div className="dialog-footer">
              <Button onClick={() => setInfo(false)}>知道了</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
function NameEditor({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} dirty={name !== initial} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          if (await onSave(name.trim())) onClose();
          setBusy(false);
        }}
      >
        <Field label="名称">
          <input
            autoFocus
            maxLength={40}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="dialog-footer">
          <Button disabled={busy}>保存</Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Projects() {
  const app = useApp();
  const edit = (id?: string) =>
    app.open(
      <NameEditor
        title={id ? "编辑项目" : "新增项目"}
        initial={app.book.projects.find((p) => p.id === id)?.name || ""}
        onClose={app.close}
        onSave={(name) =>
          app.save(id ? "编辑项目" : "新增项目", (b) => {
            if (id) b.projects.find((p) => p.id === id)!.name = name;
            else b.projects.push({ id: uid(), name, archived: false });
          })
        }
      />,
    );
  return (
    <>
      <Header title="项目" back>
        <IconButton name="Plus" label="新增项目" onClick={() => edit()} />
      </Header>
      <main className="page-content">
        {!app.book.projects.length && (
          <Empty
            icon="Folder"
            title="还没有项目"
            action={<Button onClick={() => edit()}>新增项目</Button>}
          />
        )}
        {app.book.projects.length > 0 && (
          <p className="section-note">按名称排序</p>
        )}
        {[false, true].map((archived) => {
          const projects = sortedProjects(app.book.projects).filter(
            (p) => p.archived === archived,
          );
          if (!projects.length) return null;
          return (
            <section
              className="settings-section"
              key={String(archived)}
              aria-label={archived ? "已归档项目" : "未归档项目"}
            >
              <h2>{archived ? "已归档" : "未归档"}</h2>
              <div className="settings-surface">
                {projects.map((p) => (
                  <div key={p.id} className="setting-row">
                    <Icon name="Folder" />
                    <button
                      className="grow text-left"
                      onClick={() => edit(p.id)}
                    >
                      {p.name}
                    </button>
                    <IconButton
                      name={p.archived ? "ArchiveRestore" : "Archive"}
                      label={`${p.archived ? "取消归档项目" : "归档项目"} ${p.name}`}
                      onClick={() =>
                        void app.save(
                          p.archived ? "取消归档项目" : "归档项目",
                          (b) => {
                            const project = b.projects.find(
                              (x) => x.id === p.id,
                            )!;
                            project.archived = !project.archived;
                          },
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
const categoryIcons = [
  "Utensils",
  "Coffee",
  "Carrot",
  "TramFront",
  "TrainFront",
  "CarFront",
  "Fuel",
  "ShoppingBag",
  "Package",
  "Shirt",
  "Laptop",
  "House",
  "Smartphone",
  "HeartPulse",
  "Ticket",
  "Plane",
  "BookOpen",
  "BriefcaseBusiness",
  "Gift",
  "Coins",
  "Sparkles",
  "Sprout",
  "Wallet",
  "Banknote",
  "Landmark",
  "Folder",
  "Tag",
  "CalendarDays",
];
export function CategoryEditor({
  category,
  kind,
  parentId,
  onClose,
}: {
  category?: Category;
  kind: "expense" | "income";
  parentId?: string;
  onClose: () => void;
}) {
  const app = useApp(),
    [name, setName] = useState(category?.name || ""),
    [parent, setParent] = useState(category?.parentId || parentId || ""),
    [icon, setIcon] = useState(category?.icon || "Tag"),
    [color, setColor] = useState(category?.color || "#4E7D68"),
    [error, setError] = useState("");
  const snapshot = JSON.stringify({ name, parent, icon, color }),
    initialSnapshot = useRef(snapshot),
    dirty = snapshot !== initialSnapshot.current;
  const hasChildren =
    category && app.book.categories.some((c) => c.parentId === category.id);
  return (
    <Dialog
      title={category ? "编辑类目" : "新增类目"}
      dirty={dirty}
      onClose={onClose}
    >
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (!name.trim()) return;
          const ok = await app.save("保存类目", (b) => {
            if (
              parent &&
              (!b.categories.some(
                (c) => c.id === parent && !c.parentId && !c.archived,
              ) ||
                hasChildren)
            )
              throw Error("请选择有效的大类");
            const value: Category = {
              id: category?.id || uid(),
              name: name.trim(),
              parentId: parent || undefined,
              kind,
              icon,
              color,
              archived: category?.archived || false,
              order:
                category?.order ??
                b.categories.filter(
                  (c) =>
                    c.parentId === (parent || undefined) && c.kind === kind,
                ).length,
            };
            if (category)
              b.categories[
                b.categories.findIndex((c) => c.id === category.id)
              ] = value;
            else b.categories.push(value);
          });
          if (ok) onClose();
        }}
      >
        <Field label="名称">
          <input
            autoFocus
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="上级类目">
          <select
            value={parent}
            disabled={hasChildren}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">无（独立类目）</option>
            {app.book.categories
              .filter(
                (c) =>
                  c.kind === kind &&
                  !c.parentId &&
                  !c.archived &&
                  c.id !== category?.id,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="图标">
          <span className="icon-picker">
            {categoryIcons.map((i) => (
              <button
                key={i}
                aria-label={`选择 ${i} 图标`}
                type="button"
                className={icon === i ? "selected" : ""}
                onClick={() => setIcon(i)}
              >
                <Icon name={i} />
              </button>
            ))}
          </span>
        </Field>
        <Field label="颜色">
          <span className="color-picker">
            {[
              "#4E7D68",
              "#5C7E9B",
              "#B7845D",
              "#6B8264",
              "#8F78A5",
              "#25705A",
              "#AA4B3E",
              "#7383A8",
            ]
              .concat(category?.color ? [category.color] : [])
              .filter((c, i, all) => all.indexOf(c) === i)
              .map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`颜色 ${c}`}
                  className={color === c ? "selected" : ""}
                  onClick={() => setColor(c)}
                >
                  <span className="color-swatch" style={{ background: c }}>
                    {c === color && <Icon name="Check" size={16} />}
                  </span>
                </button>
              ))}
          </span>
        </Field>
        <ErrorMessage message={error} />
        <div className="dialog-footer">
          <Button type="submit">保存类目</Button>
        </div>
      </form>
    </Dialog>
  );
}
export function Sync() {
  const app = useApp(),
    [refreshKey, setRefreshKey] = useState(0),
    [busy, setBusy] = useState(false),
    [backupsEditable, setBackupsEditable] = useState(
      () => !!readServiceView(location.origin)?.backups.length,
    ),
    [editingBackups, setEditingBackups] = useState(false);
  useEffect(() => {
    if (!backupsEditable) setEditingBackups(false);
  }, [backupsEditable]);
  const page = app.route.servicePage || "overview";
  useEffect(
    () => (busy ? app.registerLayer(() => {}) : undefined),
    [busy, app.registerLayer],
  );
  return (
    <>
      <Header title={serviceTitles[page]} back>
        {page === "backups" && backupsEditable && (
          <IconButton
            name={editingBackups ? "Check" : "Pencil"}
            label={editingBackups ? "完成备份编辑" : "编辑备份"}
            disabled={busy}
            aria-pressed={editingBackups}
            onClick={() => setEditingBackups((value) => !value)}
          />
        )}
        <IconButton
          name="RotateCcw"
          label="刷新连接状态"
          disabled={busy}
          onClick={() => app.leave(() => setRefreshKey((n) => n + 1))}
        />
      </Header>
      <main className="page-content settings-page service-page">
        <ServicePanel
          localSync={app.localSync}
          previewOnly={app.preview}
          editingBackups={editingBackups}
          onBackupAvailabilityChange={setBackupsEditable}
          page={page}
          deviceId={app.route.id}
          refreshKey={refreshKey}
          onNavigate={(servicePage, id) =>
            app.go({ page: "sync", servicePage, id })
          }
          onRestored={app.restored}
          onDeviceRevoked={app.backAfterSave}
          onSyncReviewed={app.backAfterSave}
          onBusyChange={setBusy}
          onDirtyChange={app.setDirty}
          confirm={app.confirm}
        />
      </main>
    </>
  );
}

function TimeZoneEditor({ onClose }: { onClose: () => void }) {
  const app = useApp(),
    [value, setValue] = useState(
      app.book.settings.timeZoneMode === "fixed" ? app.book.timeZone : "system",
    );
  const initialValue = useRef(value);
  return (
    <Dialog title="时区" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            value !== initialValue.current &&
            app.book.entries.length &&
            !(await app.confirm({
              title: "更改时区？",
              message:
                "交易的实际发生时间保留。列表日期和报表的每日边界会按新时区重新显示。",
              label: "更改时区",
            }))
          )
            return;
          if (
            await app.save("设置账本时区", (b) => {
              b.settings.timeZoneMode = value === "system" ? "system" : "fixed";
              if (value !== "system") b.timeZone = value;
            })
          )
            onClose();
        }}
      >
        <Field label="录入、显示与报表时区">
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="system">跟随系统 · {deviceTimeZone()}</option>
            {timeZones().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <p className="compact-note muted">
          跟随系统时，旅行会改变日期显示及报表归属，交易的实际时刻保持不变。
        </p>
        <div className="dialog-footer">
          <Button type="submit">保存</Button>
        </div>
      </form>
    </Dialog>
  );
}
