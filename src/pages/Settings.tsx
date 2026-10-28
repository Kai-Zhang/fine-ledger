import { timeZones } from "../domain/dates.ts";
import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
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
import { currencies } from "../domain/money.ts";
import { exportBook } from "../storage/repository.ts";
export function Settings() {
  const app = useApp(),
    { book } = app,
    [info, setInfo] = useState(false);
  const locked =
    book.entries.length > 0 ||
    book.accounts.some((a) => BigInt(a.openingMinor) !== 0n);
  async function backup() {
    try {
      const data = await exportBook(app.mode),
        blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `厘序-${new Date().toISOString().slice(0, 10)}.json`;
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
          <span className="brand-mark">厘</span>
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
              label="账本时区"
              value={book.timeZone}
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
              label="云端同步"
              value="未连接"
              onClick={() => app.go({ page: "sync" })}
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
        {book.settings.savedReports.length > 0 && (
          <div className="settings-section">
            <h2>已保存的报表</h2>
            <div className="settings-surface">
              {book.settings.savedReports.map((r) => (
                <div className="setting-row" key={r.id}>
                  <Icon name="ChartNoAxesCombined" />
                  <span>{r.name}</span>
                  <IconButton
                    name="Trash2"
                    label={`删除报表 ${r.name}`}
                    onClick={async () => {
                      if (
                        await app.confirm({
                          title: "删除已保存报表？",
                          message: "交易数据不会改变。",
                          label: "删除",
                          danger: true,
                        })
                      )
                        await app.save("删除报表", (b) => {
                          b.settings.savedReports =
                            b.settings.savedReports.filter(
                              (x) => x.id !== r.id,
                            );
                        });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
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
function SettingRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: string;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button className="setting-row" onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
      {value && <small>{value}</small>}
      <Icon name="ChevronRight" size={16} />
    </button>
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
    <Dialog title={title} onClose={onClose}>
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
        <div className="settings-surface">
          {app.book.projects.map((p) => (
            <div key={p.id} className="setting-row">
              <Icon name="Folder" />
              <button className="grow text-left" onClick={() => edit(p.id)}>
                {p.name}
                {p.archived && <small>已归档</small>}
              </button>
              <IconButton
                name={p.archived ? "ArchiveRestore" : "Archive"}
                label={p.archived ? "取消归档项目" : "归档项目"}
                onClick={() =>
                  void app.save("归档项目", (b) => {
                    b.projects.find((x) => x.id === p.id)!.archived =
                      !p.archived;
                  })
                }
              />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
export function Categories() {
  const app = useApp(),
    { book } = app,
    [kind, setKind] = useState<"expense" | "income">("expense"),
    [showArchived, setShowArchived] = useState(false);
  const parents = book.categories
    .filter(
      (c) => c.kind === kind && !c.parentId && (showArchived || !c.archived),
    )
    .sort((a, b) => a.order - b.order);
  const edit = (category?: Category, parentId?: string) =>
    app.open(
      <CategoryEditor
        category={category}
        kind={kind}
        parentId={parentId}
        onClose={app.close}
      />,
    );
  function menu(c: Category) {
    const siblings = book.categories
      .filter((x) => x.parentId === c.parentId && x.kind === c.kind)
      .sort((a, b) => a.order - b.order);
    app.open(
      <Dialog title={c.name} onClose={app.close}>
        <div className="menu-list">
          <button onClick={() => edit(c)}>
            <Icon name="Pencil" />
            编辑类目
          </button>
          {!c.parentId && !c.archived && (
            <button onClick={() => edit(undefined, c.id)}>
              <Icon name="Plus" />
              新增子类目
            </button>
          )}
          {[-1, 1].map((offset) => (
            <button
              key={offset}
              disabled={!siblings[siblings.indexOf(c) + offset]}
              onClick={async () => {
                await app.save("排列类目", (b) => {
                  const index = siblings.indexOf(c),
                    other = siblings[index + offset];
                  b.categories.find((x) => x.id === c.id)!.order =
                    index + offset;
                  b.categories.find((x) => x.id === other.id)!.order = index;
                });
                app.close();
              }}
            >
              <Icon name={offset === -1 ? "ArrowUpRight" : "ArrowDownLeft"} />
              {offset === -1 ? "上移" : "下移"}
            </button>
          ))}
          <button
            onClick={async () => {
              app.close();
              if (
                c.archived ||
                (await app.confirm({
                  title: "归档类目？",
                  message:
                    "历史交易和报表保留该类目，新增交易时隐藏。归档大类会同时隐藏其子类目。",
                  label: "归档",
                }))
              )
                await app.save("归档类目", (b) => {
                  b.categories
                    .filter((x) => x.id === c.id || x.parentId === c.id)
                    .forEach((x) => (x.archived = !c.archived));
                });
            }}
          >
            <Icon name={c.archived ? "ArchiveRestore" : "Archive"} />
            {c.archived ? "取消归档" : "归档类目"}
          </button>
        </div>
      </Dialog>,
    );
  }
  return (
    <>
      <Header title="类目" back>
        <IconButton name="Plus" label="新增类目" onClick={() => edit()} />
      </Header>
      <main className="page-content">
        <div className="segmented">
          <button
            className={kind === "expense" ? "selected" : ""}
            onClick={() => setKind("expense")}
          >
            支出
          </button>
          <button
            className={kind === "income" ? "selected" : ""}
            onClick={() => setKind("income")}
          >
            收入
          </button>
        </div>
        <div className="manage-categories">
          {parents.map((p) => (
            <section key={p.id}>
              <div className="setting-row">
                <span className="category-symbol" style={{ color: p.color }}>
                  <Icon name={p.icon} />
                </span>
                <strong className="grow">
                  {p.name}
                  {p.archived && <small>已归档</small>}
                </strong>
                <IconButton
                  name="MoreHorizontal"
                  label={`管理类目 ${p.name}`}
                  onClick={() => menu(p)}
                />
              </div>
              {book.categories
                .filter(
                  (c) => c.parentId === p.id && (showArchived || !c.archived),
                )
                .sort((a, b) => a.order - b.order)
                .map((c) => (
                  <div className="setting-row child-category" key={c.id}>
                    <span
                      className="category-symbol"
                      style={{ color: c.color }}
                    >
                      <Icon name={c.icon} size={19} />
                    </span>
                    <span className="grow">
                      {c.name}
                      {c.archived && <small>已归档</small>}
                    </span>
                    <IconButton
                      name="MoreHorizontal"
                      label={`管理类目 ${c.name}`}
                      onClick={() => menu(c)}
                    />
                  </div>
                ))}
            </section>
          ))}
        </div>
        <button
          className="quiet-link"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Icon name="Archive" size={16} />
          {showArchived ? "隐藏已归档类目" : "显示已归档类目"}
        </button>
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
function CategoryEditor({
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
    [color, setColor] = useState(category?.color || "#477B66"),
    [error, setError] = useState("");
  const hasChildren =
    category && app.book.categories.some((c) => c.parentId === category.id);
  return (
    <Dialog title={category ? "编辑类目" : "新增类目"} onClose={onClose}>
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
        <Field label="所属大类">
          <select
            value={parent}
            disabled={hasChildren}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">作为大类</option>
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
              "#477B66",
              "#608D9D",
              "#C68254",
              "#B87B91",
              "#7C9872",
              "#9A87B4",
              "#B95543",
              "#7383A8",
            ].map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`颜色 ${c}`}
                className={color === c ? "selected" : ""}
                style={{ background: c }}
                onClick={() => setColor(c)}
              >
                {c === color && <Icon name="Check" size={16} />}
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
  const [address, setAddress] = useState(location.origin),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Header title="云端同步" back />
      <main className="page-content sync-page">
        <div className="sync-status">
          <Icon name="CloudOff" size={34} />
          <h2>尚未连接云端账本</h2>
          <p>交易已保存在本机。连接同步服务后，可在多个设备间使用同一账本。</p>
        </div>
        <form
          className="form-surface"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setStatus("");
            try {
              const url = new URL(address);
              if (url.protocol !== "https:")
                throw Error("请使用 HTTPS 服务地址");
              const response = await fetch(
                new URL("api/sync/capabilities", url.href.replace(/\/?$/, "/")),
                { signal: AbortSignal.timeout(8000), credentials: "omit" },
              );
              if (!response.ok)
                throw Error("该地址尚未提供兼容的同步服务。本机记账不受影响。");
              const data = await response.json();
              if (data.protocol !== "fine-ledger-sync-v1")
                throw Error("该地址不是兼容的账本同步服务");
              setStatus(
                "已发现服务。当前版本尚未启用设备授权，请保留本机备份。",
              );
            } catch (e) {
              setStatus(
                (e as Error).name === "TypeError"
                  ? "无法访问服务，请检查地址与网络。"
                  : (e as Error).message,
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="服务地址">
            <input
              type="url"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>
          <Button variant="soft" disabled={busy}>
            {busy ? "检查中…" : "检查服务"}
          </Button>
          {status && (
            <p className="compact-note" role="status">
              {status}
            </p>
          )}
        </form>
        <p className="compact-note muted">
          当前部署未启用云端同步服务。导出备份可在设置中使用。
        </p>
      </main>
    </>
  );
}

function TimeZoneEditor({ onClose }: { onClose: () => void }) {
  const app = useApp(),
    [value, setValue] = useState(app.book.timeZone);
  return (
    <Dialog title="账本时区" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            value !== app.book.timeZone &&
            app.book.entries.length &&
            !(await app.confirm({
              title: "更改账本时区？",
              message:
                "交易的实际发生时间保留。列表日期和报表的每日边界会按新时区重新显示。",
              label: "更改时区",
            }))
          )
            return;
          if (
            await app.save("设置账本时区", (b) => {
              b.timeZone = value;
            })
          )
            onClose();
        }}
      >
        <Field label="业务时区">
          <select value={value} onChange={(e) => setValue(e.target.value)}>
            {timeZones().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <p className="compact-note muted">旅行或更换设备不会自动修改此设置。</p>
        <div className="dialog-footer">
          <Button type="submit">保存</Button>
        </div>
      </form>
    </Dialog>
  );
}
