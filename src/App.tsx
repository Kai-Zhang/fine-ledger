import { deviceTimeZone, timeZones } from "./domain/dates.ts";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AppContext, type Route } from "./ui/context.tsx";
import { Icon } from "./ui/icons.tsx";
import { Button, Dialog, Field, ErrorMessage } from "./ui/components.tsx";
import { Accounts, ArchiveAccounts } from "./pages/Accounts.tsx";
import { TransactionsPage, Detail, Trash } from "./pages/TransactionsPage.tsx";
import { EntryForm } from "./pages/EntryForm.tsx";
import { Reports } from "./pages/Reports.tsx";
import { Settings, Categories, Projects, Sync } from "./pages/Settings.tsx";
import {
  initialize,
  readBook,
  mutate,
  type Mode,
} from "./storage/repository.ts";
import { blankBook } from "./domain/ledger.ts";
import { uid, type Book } from "./domain/types.ts";
import { currencies, minor } from "./domain/money.ts";
import { protectUpdates, registerPWA, checkDeferredUpdate } from "./pwa.ts";
const roots = ["accounts", "transactions", "reports", "settings"] as const,
  navItems = [
    ["accounts", "Wallet", "账户"],
    ["transactions", "List", "交易"],
    ["reports", "ChartNoAxesCombined", "报表"],
    ["settings", "Settings", "设置"],
  ] as const;
export function App() {
  const [mode, setMode] = useState<Mode>(() => {
      try {
        return localStorage.getItem("fine-ledger-mode") === "example"
          ? "example"
          : "personal";
      } catch {
        return "personal";
      }
    }),
    [ready, setReady] = useState(false),
    [failure, setFailure] = useState(""),
    [route, setRoute] = useState<Route>({ page: "accounts" }),
    [modal, setModal] = useState<ReactNode>(null),
    [message, setMessage] = useState(""),
    [confirmState, setConfirm] = useState<{
      title: string;
      message: string;
      label?: string;
      danger?: boolean;
      resolve: (value: boolean) => void;
    } | null>(null);
  const dirtyRef = useRef(false),
    routeRef = useRef(route),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    historyDepth = useRef(0),
    scrolls = useRef(new Map<string, number>());
  const modalOpen = useRef(false);
  modalOpen.current = !!modal || !!confirmState;
  routeRef.current = route;
  const views = useRef(new Map<string, unknown>()).current;
  const book = useLiveQuery(() => readBook(mode), [mode]);
  const toast = (text: string) => {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 5000);
  };
  function setDirty(value: boolean) {
    dirtyRef.current = value;
    if (!value) checkDeferredUpdate();
  }
  useEffect(() => {
    setReady(false);
    setFailure("");
    initialize(mode)
      .then(() => setReady(true))
      .catch((e) => setFailure(e.message));
  }, [mode]);
  useEffect(() => {
    protectUpdates(() => dirtyRef.current || modalOpen.current);
    void registerPWA();
    history.replaceState(
      { ledger: true, depth: 0, route: { page: "accounts" } },
      "",
    );
    const pop = () => {
      const next = history.state?.route || { page: "accounts" };
      if (
        dirtyRef.current &&
        !window.confirm("尚未保存的修改将丢失，确认返回？")
      ) {
        history.pushState(
          {
            ledger: true,
            depth: historyDepth.current,
            route: routeRef.current,
          },
          "",
        );
        return;
      }
      setDirty(false);
      setModal(null);
      historyDepth.current = history.state?.depth || 0;
      setRoute(next);
    };
    window.addEventListener("popstate", pop);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("popstate", pop);
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
  }, [book?.settings.theme]);
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(".page-content");
      if (el) el.scrollTop = scrolls.current.get(JSON.stringify(route)) || 0;
    });
  }, [route]);
  async function confirm(options: {
    title: string;
    message: string;
    label?: string;
    danger?: boolean;
  }) {
    return new Promise<boolean>((resolve) =>
      setConfirm({ ...options, resolve }),
    );
  }
  function go(next: Route) {
    if (dirtyRef.current) {
      void confirm({
        title: "放弃未保存的修改？",
        message: "这笔交易尚未保存。",
        label: "放弃修改",
        danger: true,
      }).then((yes) => {
        if (yes) {
          setDirty(false);
          go(next);
        }
      });
      return;
    }
    const scroll = document.querySelector(".page-content");
    if (scroll)
      scrolls.current.set(JSON.stringify(routeRef.current), scroll.scrollTop);
    historyDepth.current++;
    history.pushState(
      { ledger: true, depth: historyDepth.current, route: next },
      "",
    );
    setRoute(next);
    setModal(null);
  }
  function back() {
    if (dirtyRef.current) {
      void confirm({
        title: "放弃未保存的修改？",
        message: "这笔交易尚未保存。",
        label: "放弃修改",
        danger: true,
      }).then((yes) => {
        if (yes) {
          setDirty(false);
          back();
        }
      });
      return;
    }
    setModal(null);
    if (historyDepth.current > 0) history.back();
    else go({ page: "accounts" });
  }
  async function save(action: string, change: (book: Book) => void) {
    try {
      await mutate(mode, action, change);
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
  function switchMode(next: Mode) {
    if (dirtyRef.current) return;
    setMode(next);
    try {
      localStorage.setItem("fine-ledger-mode", next);
    } catch {}
    setModal(null);
    setRoute({ page: "accounts" });
    historyDepth.current = 0;
    history.replaceState(
      { ledger: true, depth: 0, route: { page: "accounts" } },
      "",
    );
  }
  const startTouch = useRef<{ x: number; y: number } | null>(null);
  const isRoot =
    roots.includes(route.page as (typeof roots)[number]) &&
    !(
      route.page === "transactions" &&
      (route.from || route.to || route.accountIds || route.reportKind)
    );
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
  if (!ready)
    return (
      <div className="boot-loading">
        <span className="brand-mark">厘</span>
        <p>正在打开账本</p>
      </div>
    );
  if (!book)
    return (
      <Welcome
        onCreate={async (b) => {
          try {
            await initialize("personal", b);
            return true;
          } catch (e) {
            toast((e as Error).message);
            return false;
          }
        }}
        onExample={() => switchMode("example")}
      />
    );
  const pages: Record<Route["page"], ReactNode> = {
    accounts: <Accounts />,
    transactions: <TransactionsPage />,
    account: <TransactionsPage />,
    reports: <Reports />,
    settings: <Settings />,
    entry: <EntryForm />,
    detail: <Detail />,
    archive: <ArchiveAccounts />,
    categories: <Categories />,
    projects: <Projects />,
    trash: <Trash />,
    sync: <Sync />,
  };
  return (
    <AppContext.Provider
      value={{
        views,
        book,
        mode,
        route,
        go,
        back,
        save,
        toast,
        setDirty,
        switchMode,
        confirm,
        open: setModal,
        close: () => setModal(null),
      }}
    >
      <div
        className={`app-shell ${isRoot ? "root-page" : "sub-page"} ${route.page === "entry" ? "editing-page" : ""}`}
      >
        <aside className="sidebar">
          <button className="brand" onClick={() => go({ page: "accounts" })}>
            <span className="brand-mark">厘</span>
            <span>
              厘序<small>让每一笔，有迹可循</small>
            </span>
          </button>
          <nav aria-label="主导航">
            {navItems.map(([page, icon, label]) => (
              <button
                key={page}
                className={
                  route.page === page ||
                  (page === "accounts" && route.page === "account")
                    ? "selected"
                    : ""
                }
                onClick={() => {
                  if (route.page !== page) go({ page });
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
              <small>{mode === "example" ? "示例账本" : book.currency}</small>
            </span>
          </div>
        </aside>
        <section
          className="workspace"
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (
              t.clientX <= 24 &&
              !isRoot &&
              !modal &&
              !(e.target as HTMLElement).closest(
                "input,textarea,select,[data-no-back]",
              )
            )
              startTouch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = startTouch.current;
            startTouch.current = null;
            if (start) {
              const t = e.changedTouches[0];
              if (
                t.clientX - start.x > 85 &&
                Math.abs(t.clientY - start.y) < 60
              )
                back();
            }
          }}
          key={JSON.stringify(route)}
        >
          {pages[route.page]}
        </section>
        {isRoot && (
          <nav className="bottom-nav" aria-label="主导航">
            {navItems.map(([page, icon, label]) => (
              <button
                key={page}
                className={route.page === page ? "selected" : ""}
                aria-current={route.page === page ? "page" : undefined}
                onClick={() => {
                  if (route.page !== page) go({ page });
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
                取消
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
  onCreate,
  onExample,
}: {
  onCreate: (book: Book) => Promise<boolean>;
  onExample: () => void;
}) {
  const [currency, setCurrency] = useState("CNY"),
    [timeZone, setTimeZone] = useState(deviceTimeZone()),
    [name, setName] = useState("我的账本"),
    [account, setAccount] = useState(""),
    [opening, setOpening] = useState("0"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="welcome">
      <div className="welcome-brand">
        <span className="brand-mark">厘</span>
        <span>厘序</span>
      </div>
      <div className="welcome-content">
        <span className="eyebrow">从第一笔开始</span>
        <h1>
          把生活的账，
          <br />
          理得清楚。
        </h1>
        <p>账户、消费与净值，在一本账里。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              if (!account.trim()) throw Error("请填写第一个账户的名称");
              const b = blankBook(currency, name.trim() || "我的账本");
              b.timeZone = timeZone;
              b.accounts.push({
                id: uid(),
                name: account.trim(),
                type: "bank",
                groupId: "daily",
                currency,
                openingMinor: minor(opening, currency),
                openingAt: new Date().toISOString(),
                icon: "Landmark",
                order: 0,
                archived: false,
                netWorth: true,
              });
              setBusy(true);
              if (!(await onCreate(b))) setError("创建失败，请重试");
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
        <button className="welcome-demo" onClick={onExample}>
          先浏览示例账本
          <Icon name="ArrowUpRight" size={17} />
        </button>
      </div>
      <p className="welcome-foot">数据保存在本机，离线也能记。</p>
    </main>
  );
}
