import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { databases } from "../storage/repository.ts";
import { Button, ErrorMessage } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { useApp } from "../ui/context.tsx";
import { AccountEditor } from "../components/AccountEditor.tsx";
import { SyncEngine } from "../sync/engine.ts";
import { entity, keyOf, type Entity } from "../sync/model.ts";
import type { SyncIssue } from "../sync/state.ts";
import type { Book } from "../domain/types.ts";
import type { Collection } from "../sync/protocol.ts";
import { money } from "../domain/money.ts";
const titles: Record<Collection, string> = {
  book: "账本",
  accounts: "账户",
  groups: "分组",
  categories: "类目",
  projects: "项目",
  entries: "交易",
  reports: "常用报表",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString() + (value.match(/\.\d+/)?.[0] || "");
function fields(book: Book, c: Collection, v: Entity): [string, string][] {
  if (!v) return [["记录", "不存在或已移除"]];
  if (c === "book")
    return [
      ["名称", v.name],
      ["主币", v.currency],
      ["时区", v.timeZone],
      ["时区偏好", v.settings.timeZoneMode === "fixed" ? "固定" : "跟随系统"],
    ];
  if (c === "accounts")
    return [
      ["名称", v.name],
      ["币种", v.currency],
      ["期初余额", money(v.openingMinor, v.currency, true)],
      [
        "信用额度",
        v.creditLimitMinor !== undefined
          ? money(v.creditLimitMinor, v.currency, true)
          : "未设置",
      ],
      ["期初日期", dateLabel(v.openingAt)],
      [
        "类型",
        (
          {
            bank: "银行卡",
            cash: "现金",
            wallet: "钱包",
            credit: "信用卡",
            investment: "投资",
          } as Record<string, string>
        )[v.type] || v.type,
      ],
      ["分组", book.groups.find((g) => g.id === v.groupId)?.name || "不分组"],
      ["顺序", String(v.order + 1)],
      ["图标", v.icon],
      ["归档", v.archived ? "是" : "否"],
      ["计入净值", v.netWorth ? "是" : "否"],
    ];
  if (c === "entries") {
    const account = book.accounts.find((a) => a.id === v.accountId),
      currency = v.amountCurrency || account?.currency || book.currency;
    return [
      ["描述", v.description],
      [
        "类型",
        (
          {
            expense: "支出",
            income: "收入",
            transfer: "转账",
            refund: "退款",
            adjustment: "余额调整",
          } as Record<string, string>
        )[v.kind] || v.kind,
      ],
      ["账户", account?.name || "已移除账户"],
      ["金额", money(v.amountMinor, currency, true)],
      [
        "原始金额",
        v.originalAmount
          ? money(v.originalAmount.amountMinor, v.originalAmount.currency, true)
          : "无",
      ],
      [
        "暂估入账金额",
        v.estimatedMinor
          ? money(v.estimatedMinor, account?.currency || book.currency, true)
          : "无",
      ],
      [
        "关联转账",
        v.transferId
          ? book.entries.find((e) => e.id === v.transferId)?.description ||
            v.transferId
          : "无",
      ],
      ["日期", dateLabel(v.occurredAt)],
      ...(v.receivedAt
        ? [["转入日期", dateLabel(v.receivedAt)] as [string, string]]
        : []),
      ...(v.originalId
        ? [
            [
              "原交易",
              book.entries.find((e) => e.id === v.originalId)?.description ||
                "已移除交易",
            ] as [string, string],
          ]
        : []),
      ["入账", v.posted ? "已入账" : "未入账"],
      ["删除", v.deletedAt ? "已删除" : "否"],
      ...(v.toAccountId
        ? [
            [
              "转入账户",
              book.accounts.find((a) => a.id === v.toAccountId)?.name ||
                "已移除账户",
            ] as [string, string],
          ]
        : []),
      ...(v.receivedMinor
        ? [
            [
              "收到金额",
              money(
                v.receivedMinor,
                book.accounts.find((a) => a.id === v.toAccountId)?.currency ||
                  currency,
                true,
              ),
            ] as [string, string],
          ]
        : []),
      [
        "拆分",
        v.splits
          .map(
            (s: any) =>
              `${book.categories.find((x) => x.id === s.categoryId)?.name || "已移除类目"} ${money(s.amountMinor, currency, true)}${s.projectId ? " · " + (book.projects.find((p) => p.id === s.projectId)?.name || "已移除项目") : ""}${s.note ? " · " + s.note : ""}`,
          )
          .join("；") || "无",
      ],
      ["备注", v.note || "无"],
      ["创建时间", dateLabel(v.createdAt)],
      ["更新时间", dateLabel(v.updatedAt)],
    ];
  }
  if (c === "categories")
    return [
      ["名称", v.name],
      ["收支", v.kind === "income" ? "收入" : "支出"],
      ["上级", book.categories.find((x) => x.id === v.parentId)?.name || "无"],
      ["归档", v.archived ? "是" : "否"],
      ["图标", v.icon],
      ["颜色", v.color],
      ["顺序", String(v.order + 1)],
    ];
  if (c === "reports")
    return [
      ["名称", v.name],
      ["类型", v.type === "net" ? "净值" : "支出分类"],
      ["日期范围", v.from || v.days],
      ["截至", v.to || "当前"],
      [
        "账户",
        v.accountIds
          .map(
            (id: string) =>
              book.accounts.find((a) => a.id === id)?.name || "已移除账户",
          )
          .join("、") || "全部",
      ],
      [
        "类目",
        v.categoryIds
          .map(
            (id: string) =>
              book.categories.find((a) => a.id === id)?.name || "已移除类目",
          )
          .join("、") || "全部",
      ],
    ];
  return [
    ["名称", v.name],
    ...(v.order !== undefined
      ? [["顺序", String(v.order + 1)] as [string, string]]
      : []),
    ...(v.archived !== undefined
      ? [["归档", v.archived ? "是" : "否"] as [string, string]]
      : []),
  ];
}
function Version({
  label,
  book,
  collection,
  value,
  names,
}: {
  label: string;
  book: Book;
  collection: Collection;
  value: Entity;
  names: Set<string>;
}) {
  return (
    <section className="conflict-version">
      <h3>{label}</h3>
      <dl>
        {fields(book, collection, value)
          .filter(([name]) => names.has(name))
          .map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{name === "图标" ? <Icon name={value} /> : value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
export function SyncReview({
  issue,
  onResolved,
  onBusyChange,
}: {
  issue: SyncIssue;
  onResolved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const app = useApp(),
    local = useLiveQuery(
      () => databases.personal.state.get("book") as Promise<Book>,
      [],
    );
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>(
      {},
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(20);
  if (!local) return null;
  const complete = issue.items.every(
    (i) => !!choices[keyOf(i.collection, i.id)],
  );
  function all(value: "local" | "remote") {
    setChoices(
      Object.fromEntries(
        issue.items.map((i) => [keyOf(i.collection, i.id), value]),
      ),
    );
  }
  return (
    <>
      <p className="section-note">{issue.message}。所有本机内容仍保留。</p>
      {issue.kind === "recovery" && (
        <p className="section-note">
          本机可能保留了比服务备份更新的已确认记录。选择本机版本可补回这些内容；远端独有的新记录仍保留。
        </p>
      )}
      <div className="conflict-bulk">
        <Button variant="soft" disabled={busy} onClick={() => all("local")}>
          全部保留本机
        </Button>
        <Button variant="soft" disabled={busy} onClick={() => all("remote")}>
          全部采用远端
        </Button>
      </div>
      <p className="section-note">
        共 {issue.items.length} 项差异；没有选择的项目不会被覆盖。
      </p>
      {issue.items.slice(0, limit).map((item) => {
        const key = keyOf(item.collection, item.id),
          here = entity(local, item.collection, item.id);
        const versions = [
          fields(issue.baseBook, item.collection, item.base),
          fields(local, item.collection, here),
          fields(issue.remoteBook, item.collection, item.remote),
        ].map((rows) => new Map(rows));
        const allNames = new Set(versions.flatMap((v) => [...v.keys()]));
        const changed = new Set(
          [...allNames].filter(
            (name) =>
              new Set(versions.map((v) => v.get(name) || "无")).size > 1,
          ),
        );
        const names = changed.size ? changed : allNames;
        const label =
          here?.name ||
          here?.description ||
          item.remote?.name ||
          item.remote?.description ||
          titles[item.collection];
        return (
          <section key={key} className="settings-section">
            <h2>
              {titles[item.collection]} · {label}
            </h2>
            <div className="settings-surface conflict-item">
              <details open={issue.items.length === 1}>
                <summary>对比原始、本机与远端版本</summary>
                <div className="conflict-versions">
                  <Version
                    label="原始版本"
                    book={issue.baseBook}
                    collection={item.collection}
                    value={item.base}
                    names={names}
                  />
                  <Version
                    label="本机版本"
                    book={local}
                    collection={item.collection}
                    value={here}
                    names={names}
                  />
                  <Version
                    label="远端版本"
                    book={issue.remoteBook}
                    collection={item.collection}
                    value={item.remote}
                    names={names}
                  />
                </div>
              </details>
              <fieldset disabled={busy} className="conflict-choices">
                <legend>保留哪个版本</legend>
                <label>
                  <input
                    type="radio"
                    name={key}
                    checked={choices[key] === "local"}
                    onChange={() => setChoices({ ...choices, [key]: "local" })}
                  />
                  本机版本
                </label>
                <label>
                  <input
                    type="radio"
                    name={key}
                    checked={choices[key] === "remote"}
                    onChange={() => setChoices({ ...choices, [key]: "remote" })}
                  />
                  远端版本
                </label>
              </fieldset>
              {item.collection === "entries" && here && (
                <Button
                  variant="plain"
                  disabled={busy}
                  onClick={() => app.go({ page: "entry", id: item.id })}
                >
                  修改本机交易
                </Button>
              )}
              {item.collection === "accounts" && here && (
                <Button
                  variant="plain"
                  disabled={busy}
                  onClick={() =>
                    app.open(
                      <AccountEditor
                        account={local.accounts.find((a) => a.id === item.id)}
                        onClose={app.close}
                      />,
                    )
                  }
                >
                  修改本机账户
                </Button>
              )}
            </div>
          </section>
        );
      })}
      {limit < issue.items.length && (
        <Button variant="plain" onClick={() => setLimit((n) => n + 20)}>
          再显示 20 项
        </Button>
      )}
      <ErrorMessage message={error} />
      <div className="service-actions">
        <Button
          disabled={busy || !complete}
          onClick={() => {
            setBusy(true);
            onBusyChange(true);
            setError("");
            void new SyncEngine()
              .resolve(choices, issue.id)
              .then(onResolved)
              .catch((e) => {
                setError(e.message);
                if (e.message.includes("远端又有变化")) setChoices({});
              })
              .finally(() => {
                setBusy(false);
                onBusyChange(false);
              });
          }}
        >
          {busy ? "正在核对…" : "确认并继续同步"}
        </Button>
      </div>
      <p className="section-note">
        确认前会保留本机副本。保留本机版本仍需通过金额与关联关系校验，不会强行覆盖。
      </p>
    </>
  );
}
