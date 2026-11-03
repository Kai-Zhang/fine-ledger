import { LocalBackup, LocalBackupPanel } from "./pages/LocalBackup.tsx";
import { useSyncCoordinator } from "./sync/useSync.ts";
import { requestSync } from "./sync/engine.ts";
import { readLocalSyncState, type LocalSyncView } from "./sync/local-view.ts";
import {
  initialStartNavigation,
  startNavigate,
  type StartPage,
} from "./navigation/onboarding.ts";
import { ServicePanel } from "./pages/ServicePanel.tsx";
import { useSwipe } from "./navigation/useSwipe.ts";
import { flushSync } from "react-dom";
import { Categories } from "./pages/Categories.tsx";
import {
  initialNavigation,
  currentFrame,
  navigate,
  type NavigationAction,
} from "./navigation/stack.ts";
import {
  deviceTimeZone,
  timeZones,
  effectiveTimeZone,
} from "./domain/dates.ts";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AppContext, type Route } from "./ui/context.tsx";
import { Icon } from "./ui/icons.tsx";
import {
  Button,
  IconButton,
  SettingRow,
  Dialog,
  Field,
  ErrorMessage,
  BrandMark,
} from "./ui/components.tsx";
import { Accounts, ArchiveAccounts } from "./pages/Accounts.tsx";
import { TransactionsPage, Detail, Trash } from "./pages/TransactionsPage.tsx";
import { EntryForm } from "./pages/EntryForm.tsx";
import { Reports, ReportCatalog } from "./pages/Reports.tsx";
import { Settings, Projects, Sync } from "./pages/Settings.tsx";
import {
  databases,
  initialize,
  readBook,
  mutate,
} from "./storage/repository.ts";
import { blankBook } from "./domain/ledger.ts";
import { uid, type Book } from "./domain/types.ts";
import { currencies, minor } from "./domain/money.ts";
import { protectUpdates, registerPWA, checkDeferredUpdate } from "./pwa.ts";
const navItems = [
  ["accounts", "Wallet", "账户"],
  ["transactions", "List", "交易"],
  ["reports", "ChartNoAxesCombined", "报表"],
  ["settings", "Settings", "设置"],
] as const;
export function App() {
  const mode = "personal" as const;
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState(""),
    [navigation, setNavigation] = useState(initialNavigation),
    [modal, setModal] = useState<ReactNode>(null),
    [message, setMessage] = useState(""),
    [confirmState, setConfirm] = useState<{
      title: string;
      message: string;
      label?: string;
      danger?: boolean;
      cancelLabel?: string;
      resolve: (value: boolean) => void;
    } | null>(null);
  const frame = currentFrame(navigation),
    route = frame.route;
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const editBase = useRef<Book | undefined>(undefined);
  const dirtyRef = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    layers = useRef<{ close: () => void; dirty: () => boolean }[]>([]),
    pendingLeave = useRef(false),
    scrolls = useRef(new Map<string, number>());
  const modalOpen = useRef(false);
  modalOpen.current = !!modal || !!confirmState;

  const views = useRef(new Map<string, unknown>()).current;
  const storedBook = useLiveQuery(() => readBook(mode), [mode]);
  const syncState = useLiveQuery(
    () => readLocalSyncState(databases.personal),
    [],
  );
  const localSync = useMemo(
    () => (syncState ? { ...syncState, book: storedBook } : undefined),
    [syncState, storedBook],
  );
  const [systemZone, setSystemZone] = useState(deviceTimeZone);
  const book = useMemo(
    () =>
      storedBook
        ? { ...storedBook, timeZone: effectiveTimeZone(storedBook, systemZone) }
        : storedBook,
    [storedBook, systemZone],
  );
  useSyncCoordinator(
    ready && !!book,
    () =>
      !dirtyRef.current &&
      !modalOpen.current &&
      !(
        ["entry", "local-backup"].includes(
          navigationRef.current.stacks[navigationRef.current.tab].past.at(-1)
            ?.route.page || "",
        ) ||
        ["restore", "review", "publish"].includes(
          navigationRef.current.stacks[navigationRef.current.tab].past.at(-1)
            ?.route.servicePage || "",
        )
      ),
  );
  useEffect(() => {
    const update = () => setSystemZone(deviceTimeZone());
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const toast = (text: string) => {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 5000);
  };
  const setDirty = useCallback((value: boolean) => {
    const wasDirty = dirtyRef.current;
    dirtyRef.current = value;
    if (wasDirty && !value) {
      checkDeferredUpdate();
      requestSync();
    }
  }, []);
  useEffect(() => {
    setReady(false);
    setFailure("");
    window.__ledgerStartup?.mark("database-start");
    initialize(mode)
      .then(() => {
        window.__ledgerStartup?.mark("database-ready");
        setReady(true);
      })
      .catch((e) => {
        window.__ledgerStartup?.fail(e.name);
        setFailure(e.message);
      });
  }, [mode]);
  useEffect(() => {
    if (ready && !failure) window.__ledgerStartup?.ready();
  }, [ready, failure]);
  useEffect(() => {
    protectUpdates(
      () => dirtyRef.current || modalOpen.current || layers.current.length > 0,
    );
    void registerPWA();
    // Internal pages are not browser history entries. Old sentinels are no longer created.
    history.replaceState({ ledger: true, version: 3 }, "");
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || layers.current.some((layer) => layer.dirty())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    if (!modal && !confirmState && !dirtyRef.current) checkDeferredUpdate();
  }, [modal, confirmState]);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty(
        "--view-height",
        `${vv?.height || innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        "--view-top",
        `${vv?.offsetTop || 0}px`,
      );
      document.documentElement.classList.toggle(
        "keyboard-open",
        innerHeight - (vv?.height || innerHeight) > 140,
      );
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    const theme = book?.settings.theme || "system";
    document.documentElement.dataset.theme = theme;
    const system = matchMedia("(prefers-color-scheme: dark)");
    const updateChrome = () => {
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          getComputedStyle(document.documentElement)
            .getPropertyValue("--bg")
            .trim(),
        );
    };
    updateChrome();
    if (theme === "system") system.addEventListener("change", updateChrome);
    return () => system.removeEventListener("change", updateChrome);
  }, [book?.settings.theme]);
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(
        ".workspace[data-active] .page-content",
      );
      if (el) el.scrollTop = scrolls.current.get(String(frame.key)) || 0;
    });
  }, [frame.key]);
  async function confirm(options: {
    title: string;
    message: string;
    label?: string;
    danger?: boolean;
    cancelLabel?: string;
  }) {
    return new Promise<boolean>((resolve) =>
      setConfirm({ ...options, resolve }),
    );
  }
  function leave(action: () => void, dirty = dirtyRef.current) {
    if (pendingLeave.current) return;
    if (!dirty) {
      action();
      return;
    }
    pendingLeave.current = true;
    void confirm({
      title: "放弃未保存的修改？",
      message: "修改尚未保存。",
      label: "放弃修改",
      cancelLabel: "继续填写",
      danger: true,
    }).then((yes) => {
      pendingLeave.current = false;
      if (yes) action();
    });
  }
  function commit(action: NavigationAction) {
    const next = navigate(navigationRef.current, action);
    if (next === navigationRef.current) return;
    editBase.current =
      currentFrame(next).route.page === "entry" && storedBook
        ? structuredClone(storedBook)
        : undefined;
    const scroll = document.querySelector(
      ".workspace[data-active] .page-content",
    );
    if (scroll)
      scrolls.current.set(
        String(currentFrame(navigationRef.current).key),
        scroll.scrollTop,
      );
    setDirty(false);
    navigationRef.current = next;
    setNavigation(next);
  }
  function request(direction: "back" | "forward") {
    if (pendingLeave.current || confirmState) return;
    const top = layers.current.at(-1);
    if (top) {
      if (direction === "back") top.close();
      return;
    }
    const state = navigationRef.current;
    if (navigate(state, { type: direction }) === state) return;
    leave(() => commit({ type: direction }));
  }
  const requestRef = useRef(request);
  requestRef.current = request;
  function go(next: Route) {
    leave(() => {
      setModal(null);
      commit({ type: "open", route: next });
    });
  }
  const back = () => request("back");
  const forward = () => request("forward");
  function swipeNavigate(direction: "back" | "forward") {
    const key = currentFrame(navigationRef.current).key,
      top = layers.current.at(-1);
    setTimeout(() => {
      if (
        key === currentFrame(navigationRef.current).key &&
        top === layers.current.at(-1)
      )
        requestRef.current(direction);
    }, 160);
  }
  const registerLayer = useRef(
    (close: () => void, dirty: () => boolean = () => false) => {
      const layer = { close, dirty };
      layers.current.push(layer);
      return () => {
        layers.current = layers.current.filter((x) => x !== layer);
        checkDeferredUpdate();
      };
    },
  ).current;
  async function save(action: string, change: (book: Book) => void) {
    try {
      const saved = await mutate(
        mode,
        action,
        change,
        editBase.current || storedBook,
      );
      if (editBase.current) editBase.current = structuredClone(saved);
      requestSync();
      return true;
    } catch (e) {
      toast(
        (e as Error).name === "QuotaExceededError"
          ? "本机存储空间不足，输入内容已保留。"
          : (e as Error).message || "保存失败，输入内容已保留。",
      );
      return false;
    }
  }
  const branch = navigation.stacks[navigation.tab];
  const isRoot = branch.past.length === 1;
  const {
    target: swipeTarget,
    pointer,
    attachSurface,
  } = useSwipe(
    navigation,
    () => !book || pendingLeave.current || !!confirmState,
    () => !!layers.current.length,
    (d) => requestRef.current(d),
    () => dirtyRef.current,
    async () => {
      if (pendingLeave.current) return false;
      pendingLeave.current = true;
      const yes = await confirm({
        title: "放弃未保存的修改？",
        message: "修改尚未保存。",
        label: "放弃修改",
        cancelLabel: "继续填写",
        danger: true,
      });
      pendingLeave.current = false;
      if (yes) setDirty(false);
      return yes;
    },
  );
  function restored() {
    views.clear();
    scrolls.current.clear();
    setDirty(false);
    setModal(null);
    const next = initialNavigation();
    navigationRef.current = next;
    setNavigation(next);
  }
  if (failure)
    return (
      <div className="boot-error">
        <Icon name="AlertCircle" size={32} />
        <h1>暂时无法打开账本</h1>
        <p>本机数据没有被清除。请重新打开页面再试。</p>
        <Button onClick={() => location.reload()}>重新打开</Button>
        <details>
          <summary>错误详情</summary>
          {failure}
        </details>
      </div>
    );
  if (!ready || !localSync)
    return (
      <div className="boot-loading" data-startup-shell>
        <BrandMark />
        <h1 data-startup-heading>正在打开账本</h1>
        <p data-startup-message>离线也能使用已保存的账本。</p>
        <a href="/">重新打开</a>
      </div>
    );
  if (!book)
    return (
      <Welcome
        localSync={localSync}
        onRestored={restored}
        onDirtyChange={setDirty}
        onCreate={async (b) => {
          try {
            await initialize("personal", b);
            return true;
          } catch (e) {
            toast((e as Error).message);
            return false;
          }
        }}
      />
    );
  const pages: Record<Route["page"], ReactNode> = {
    accounts: <Accounts />,
    transactions: <TransactionsPage />,
    account: <TransactionsPage />,
    reports: <ReportCatalog />,
    report: <Reports />,
    settings: <Settings />,
    entry: <EntryForm />,
    detail: <Detail />,
    archive: <ArchiveAccounts />,
    categories: <Categories />,
    projects: <Projects />,
    trash: <Trash />,
    sync: <Sync />,
    "local-backup": <LocalBackup />,
  };
  return (
    <AppContext.Provider
      value={{
        frameKey: frame.key,
        views,
        localSync,
        restored,
        book,
        mode,
        route,
        go,
        back,
        backAfterSave: () => commit({ type: "back" }),
        forward,
        swipe: swipeNavigate,
        registerLayer,
        leave,
        save,
        toast,
        setDirty,
        confirm,
        open: (node) => {
          editBase.current = storedBook
            ? structuredClone(storedBook)
            : undefined;
          setModal(node);
        },
        close: () => {
          editBase.current = undefined;
          flushSync(() => setModal(null));
          requestSync();
        },
      }}
    >
      <div
        className={`app-shell ${isRoot ? "root-page" : "sub-page"} ${route.page === "entry" ? "editing-page" : ""}`}
      >
        {
          <div
            className="edge-swipe-zone back-edge"
            aria-hidden="true"
            {...pointer}
          />
        }
        {
          <div
            className="edge-swipe-zone forward-edge"
            aria-hidden="true"
            {...pointer}
          />
        }
        <aside className="sidebar">
          <button className="brand" onClick={() => go({ page: "accounts" })}>
            <BrandMark />
            <span>
              厘序<small>让每一笔，有迹可循</small>
            </span>
          </button>
          <nav aria-label="主导航">
            {navItems.map(([page, icon, label]) => (
              <button
                key={page}
                className={navigation.tab === page ? "selected" : ""}
                onClick={() => {
                  go({ page });
                }}
              >
                <Icon name={icon} />
                {label}
              </button>
            ))}
          </nav>
          <div className="sidebar-book">
            <Icon name="BookOpen" />
            <span>
              {book.name}
              <small>{book.currency}</small>
            </span>
          </div>
        </aside>
        {swipeTarget && (
          <AppContext.Provider
            value={{
              preview: true,
              frameKey: swipeTarget.key,
              localSync,
              restored: () => {},
              views,
              book,
              mode,
              route: swipeTarget.route,
              go: () => {},
              back: () => {},
              backAfterSave: () => {},
              forward: () => {},
              swipe: () => {},
              registerLayer: () => () => {},
              leave: () => {},
              save: async () => false,
              toast: () => {},
              setDirty: () => {},
              confirm: async () => false,
              open: () => {},
              close: () => {},
            }}
          >
            <section
              className={`workspace navigation-underlay ${swipeTarget.key === branch.past[0].key ? "preview-root" : ""}`}
              inert
              aria-hidden="true"
              ref={(el) => {
                if (el) {
                  const scroll = el.querySelector(".page-content");
                  if (scroll)
                    scroll.scrollTop =
                      scrolls.current.get(String(swipeTarget!.key)) || 0;
                }
              }}
            >
              {pages[swipeTarget.route.page]}
              {swipeTarget.key === branch.past[0].key && (
                <nav className="preview-bottom-nav">
                  {navItems.map(([p, icon, label]) => (
                    <span
                      className={p === navigation.tab ? "selected" : ""}
                      key={p}
                    >
                      <Icon name={icon} />
                      {label}
                    </span>
                  ))}
                </nav>
              )}
            </section>
          </AppContext.Provider>
        )}
        <section
          data-active="true"
          className={`workspace ${route.page === "account" || route.page === "transactions" ? "ledger-list-workspace" : ""}`}
          ref={attachSurface}
          key={frame.key}
        >
          {pages[route.page]}
        </section>
        {isRoot && (
          <nav className="bottom-nav" aria-label="主导航">
            {navItems.map(([page, icon, label]) => (
              <button
                key={page}
                className={navigation.tab === page ? "selected" : ""}
                aria-current={navigation.tab === page ? "page" : undefined}
                onClick={() => {
                  go({ page });
                }}
              >
                <Icon name={icon} size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
      {modal}
      {confirmState && (
        <Dialog
          guard={false}
          title={confirmState.title}
          onClose={() => {
            confirmState.resolve(false);
            setConfirm(null);
          }}
        >
          <div className="dialog-body">
            <p>{confirmState.message}</p>
            <div className="dialog-footer">
              <Button
                variant="plain"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirm(null);
                }}
              >
                {confirmState.cancelLabel || "取消"}
              </Button>
              <Button
                variant={confirmState.danger ? "danger" : "primary"}
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirm(null);
                }}
              >
                {confirmState.label || "确认"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {message && (
        <div role="status" className="toast" onClick={() => setMessage("")}>
          {message}
        </div>
      )}
    </AppContext.Provider>
  );
}
function Welcome({
  localSync,
  onCreate,
  onRestored,
  onDirtyChange,
}: {
  localSync: LocalSyncView;
  onCreate: (book: Book) => Promise<boolean>;
  onRestored: () => void;
  onDirtyChange: (value: boolean) => void;
}) {
  const [navigation, setNavigation] = useState(initialStartNavigation);
  const current = navigation.stacks.start.past.at(-1)!;
  const seen = useRef(new Set<StartPage>(["choose"]));
  seen.current.add(current.page);
  const [currency, setCurrency] = useState("CNY"),
    [timeZone, setTimeZone] = useState("system"),
    [name, setName] = useState("我的账本"),
    [account, setAccount] = useState(""),
    [opening, setOpening] = useState("0"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [serviceBusy, setServiceBusy] = useState(false),
    [connectDirty, setConnectDirty] = useState(false);
  const createDirty =
    account !== "" ||
    name !== "我的账本" ||
    opening !== "0" ||
    currency !== "CNY" ||
    timeZone !== "system";
  useEffect(() => {
    onDirtyChange(createDirty || connectDirty || busy || serviceBusy);
    return () => onDirtyChange(false);
  }, [createDirty, connectDirty, busy, serviceBusy, onDirtyChange]);
  function step(direction: "back" | "forward") {
    if (!busy && !serviceBusy)
      setNavigation((n) => startNavigate(n, { type: direction }));
  }
  const {
    target: swipeTarget,
    pointer,
    attachSurface,
  } = useSwipe(
    navigation,
    () => busy || serviceBusy,
    () => false,
    step,
    () => false,
    async () => true,
  );
  const title = (page: StartPage) =>
    page === "create"
      ? "新建账本"
      : page === "connect"
        ? "连接已有账本"
        : page === "file"
          ? "从备份文件恢复"
          : "开始使用厘序";
  return (
    <div className="start-flow">
      <div
        className="edge-swipe-zone back-edge"
        aria-hidden="true"
        {...pointer}
      />
      <div
        className="edge-swipe-zone forward-edge"
        aria-hidden="true"
        {...pointer}
      />
      {(["choose", "create", "connect", "file"] as const)
        .filter((page) => seen.current.has(page))
        .map((page) => {
          const active = current.page === page,
            underlay = swipeTarget?.page === page;
          return (
            <section
              key={page}
              className={`start-frame ${underlay && !active ? "start-underlay" : ""}`}
              hidden={!active && !underlay}
              inert={!active}
              aria-hidden={!active}
              ref={active ? attachSurface : undefined}
            >
              <header
                className={`page-header ${page !== "choose" ? "has-back" : ""}`}
              >
                {page !== "choose" && (
                  <IconButton
                    name="ArrowLeft"
                    label="返回账本选择"
                    disabled={busy || serviceBusy}
                    onClick={() => step("back")}
                  />
                )}
                <div className="header-title">
                  <h1>{title(page)}</h1>
                </div>
              </header>
              <main className="page-content start-content">
                {page === "choose" && (
                  <>
                    <div className="start-brand">
                      <BrandMark />
                      <p>账户、消费与净值，保存在自己的账本里。</p>
                    </div>
                    <div
                      className="settings-surface start-choices"
                      aria-label="选择账本来源"
                    >
                      <SettingRow
                        icon="BookOpen"
                        label="新建账本"
                        detail="从空白账本开始记录"
                        onClick={() =>
                          setNavigation((n) =>
                            startNavigate(n, { type: "open", page: "create" }),
                          )
                        }
                      />
                      <SettingRow
                        icon="Cloud"
                        label="连接已有账本"
                        detail="下载远端账本，在本机继续使用"
                        onClick={() =>
                          setNavigation((n) =>
                            startNavigate(n, { type: "open", page: "connect" }),
                          )
                        }
                      />
                      <SettingRow
                        icon="ArchiveRestore"
                        label="从备份文件恢复"
                        detail="导入完整备份，在本机恢复账本"
                        onClick={() =>
                          setNavigation((n) =>
                            startNavigate(n, { type: "open", page: "file" }),
                          )
                        }
                      />
                    </div>
                    <p className="section-note">
                      数据保存在本机，离线也能记账。
                    </p>
                  </>
                )}
                {page === "create" && (
                  <>
                    <p className="section-note">
                      先建立账本和第一个账户，之后可继续添加。
                    </p>
                    <form
                      className="form-surface start-create-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setError("");
                        try {
                          if (!account.trim())
                            throw Error("请填写第一个账户的名称");
                          const b = blankBook(
                            currency,
                            name.trim() || "我的账本",
                          );
                          b.groups = [];
                          b.timeZone =
                            timeZone === "system" ? deviceTimeZone() : timeZone;
                          b.settings.timeZoneMode =
                            timeZone === "system" ? "system" : "fixed";
                          b.accounts.push({
                            id: uid(),
                            name: account.trim(),
                            type: "bank",
                            groupId: "",
                            currency,
                            openingMinor: minor(opening, currency),
                            openingAt: new Date().toISOString(),
                            icon: "Landmark",
                            order: 0,
                            archived: false,
                            netWorth: true,
                          });
                          setBusy(true);
                          if (!(await onCreate(b)))
                            setError("创建失败，请重试");
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <div className="form-grid">
                        <Field label="账本名称">
                          <input
                            value={name}
                            maxLength={40}
                            onChange={(e) => setName(e.target.value)}
                          />
                        </Field>
                        <Field label="主币种">
                          <select
                            value={currency}
                            onChange={(e) => {
                              setCurrency(e.target.value);
                              setOpening("0");
                            }}
                          >
                            {currencies.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field label="时区">
                        <select
                          value={timeZone}
                          onChange={(e) => setTimeZone(e.target.value)}
                        >
                          <option value="system">
                            跟随系统 · {deviceTimeZone()}
                          </option>
                          {timeZones().map((zone) => (
                            <option key={zone}>{zone}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="第一个账户">
                        <input
                          value={account}
                          maxLength={40}
                          onChange={(e) => setAccount(e.target.value)}
                          placeholder="例如：日常储蓄卡"
                          required
                        />
                      </Field>
                      <Field label={`当前余额 · ${currency}`}>
                        <input
                          inputMode="decimal"
                          value={opening}
                          onChange={(e) => setOpening(e.target.value)}
                        />
                      </Field>
                      <ErrorMessage message={error} />
                      <Button type="submit" disabled={busy}>
                        {busy ? "创建中…" : "开始记账"}
                        <Icon name="ArrowRight" size={18} />
                      </Button>
                    </form>
                  </>
                )}
                {page === "file" && (
                  <LocalBackupPanel
                    onRestored={onRestored}
                    onBusyChange={setServiceBusy}
                  />
                )}
                {page === "connect" && (
                  <ServicePanel
                    onboarding
                    localSync={localSync}
                    onRestored={onRestored}
                    onBusyChange={setServiceBusy}
                    onDirtyChange={setConnectDirty}
                  />
                )}
              </main>
            </section>
          );
        })}
    </div>
  );
}
