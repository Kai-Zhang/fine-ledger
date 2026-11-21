import { AmountInput } from "./AmountInput.tsx";
import { sortedProjects } from "../domain/organization.ts";
import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import { Dialog, Field, Button, ErrorMessage } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import {
  emptyFilter,
  validateFilter,
  type TransactionFilter,
} from "../domain/filters.ts";
import { currencies } from "../domain/money.ts";
import { kindLabel } from "./Transactions.tsx";
import type { Kind } from "../domain/types.ts";
export function TransactionFilters({
  value,
  scope,
  count,
  onApply,
  onClose,
}: {
  value: TransactionFilter;
  scope?: string;
  count: (f: TransactionFilter) => number;
  onApply: (f: TransactionFilter) => void;
  onClose: () => void;
}) {
  const { book } = useApp(),
    [draft, setDraft] = useState(() => structuredClone(value));
  const account = book.accounts.find((a) => a.id === scope);
  const change = <K extends keyof TransactionFilter>(
    key: K,
    value: TransactionFilter[K],
  ) => setDraft((f) => ({ ...f, [key]: value }));
  function toggle(
    key: "accounts" | "kinds" | "categories" | "projects",
    id: string,
  ) {
    setDraft((f) => ({
      ...f,
      [key]: f[key].includes(id as Kind)
        ? f[key].filter((x) => x !== id)
        : [...f[key], id],
    }));
  }
  let error = "",
    total = 0;
  try {
    validateFilter(draft, book.timeZone);
    total = count(draft);
  } catch (e) {
    error = (e as Error).message;
  }
  const checkbox = (
    key: "accounts" | "kinds" | "categories" | "projects",
    id: string,
    label: string,
    icon?: string,
    disabled = false,
    checked?: boolean,
  ) => (
    <label className="check-row" key={id}>
      <input
        type="checkbox"
        checked={checked ?? draft[key].includes(id as Kind)}
        disabled={disabled}
        onChange={() => toggle(key, id)}
      />
      {icon && <Icon name={icon} size={18} />}
      <span>{label}</span>
    </label>
  );
  return (
    <Dialog title="筛选交易" onClose={onClose} dirty={false}>
      <div className="dialog-body transaction-filters">
        <Field label="时间">
          <select
            value={draft.period}
            onChange={(e) =>
              change("period", e.target.value as TransactionFilter["period"])
            }
          >
            <option value="">所有时间</option>
            <option value="month">本月</option>
            <option value="lastMonth">上月</option>
            <option value="30">近 30 天</option>
            <option value="custom">自定义</option>
          </select>
        </Field>
        {draft.period === "custom" && (
          <div className="form-grid">
            <Field label="开始日期">
              <input
                type="date"
                value={draft.from}
                onChange={(e) => change("from", e.target.value)}
              />
            </Field>
            <Field label="结束日期">
              <input
                type="date"
                value={draft.to}
                onChange={(e) => change("to", e.target.value)}
              />
            </Field>
          </div>
        )}
        <details className="filter-section" open>
          <summary>
            账户{" "}
            <small>
              {scope
                ? account?.name
                : draft.accounts.length
                  ? `${draft.accounts.length} 个`
                  : "全部"}
            </small>
          </summary>
          {scope ? (
            <p className="muted">
              {account?.name} · {account?.currency}
            </p>
          ) : (
            [{ id: "", name: "未分组", order: -1 }, ...book.groups]
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((g) => (
                <div key={g.id}>
                  <h4>{g.name}</h4>
                  {book.accounts
                    .filter((a) => a.groupId === g.id)
                    .sort((a, b) => a.order - b.order)
                    .map((a) =>
                      checkbox(
                        "accounts",
                        a.id,
                        `${a.name}${a.archived ? " · 已归档" : ""} · ${a.currency}`,
                        a.icon,
                      ),
                    )}
                </div>
              ))
          )}
        </details>
        <details className="filter-section" open>
          <summary>
            交易类型 <small>{draft.kinds.length || "全部"}</small>
          </summary>
          <div className="filter-check-grid">
            {(Object.keys(kindLabel) as Kind[]).map((k) =>
              checkbox("kinds", k, kindLabel[k]),
            )}
          </div>
        </details>
        <details className="filter-section">
          <summary>
            类目 <small>{draft.categories.length || "全部"}</small>
          </summary>
          {(["expense", "income"] as const).map((kind) => (
            <div key={kind}>
              <h4>{kind === "expense" ? "支出" : "收入"}</h4>
              {book.categories
                .filter((c) => c.kind === kind && !c.parentId)
                .sort((a, b) => a.order - b.order)
                .map((p) => (
                  <details className="category-check" key={p.id}>
                    <summary>
                      {checkbox("categories", p.id, p.name, p.icon)}
                      <Icon name="ChevronDown" size={16} />
                    </summary>
                    {book.categories
                      .filter((c) => c.parentId === p.id)
                      .sort((a, b) => a.order - b.order)
                      .map((c) => (
                        <div className="child" key={c.id}>
                          {checkbox(
                            "categories",
                            c.id,
                            c.name,
                            c.icon,
                            draft.categories.includes(p.id),
                            draft.categories.includes(p.id) ||
                              draft.categories.includes(c.id),
                          )}
                        </div>
                      ))}
                  </details>
                ))}
            </div>
          ))}
        </details>
        <details className="filter-section">
          <summary>
            项目 <small>{draft.projects.length || "全部"}</small>
          </summary>
          {checkbox("projects", "none", "无项目")}
          {sortedProjects(book.projects).map((p) =>
            checkbox(
              "projects",
              p.id,
              p.name + (p.archived ? " · 已归档" : ""),
              "Folder",
            ),
          )}
        </details>
        <details className="filter-section" open>
          <summary>
            入账状态{" "}
            <small>
              {
                { all: "全部", posted: "已入账", pending: "未入账" }[
                  draft.status
                ]
              }
            </small>
          </summary>
          <div
            className="filter-check-grid"
            role="radiogroup"
            aria-label="入账状态"
          >
            {(
              [
                ["all", "全部"],
                ["posted", "已入账"],
                ["pending", "未入账"],
              ] as const
            ).map(([status, label]) => (
              <label className="check-row" key={status}>
                <input
                  type="radio"
                  name="transaction-posting-status"
                  checked={draft.status === status}
                  onChange={() => change("status", status)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </details>
        <details className="filter-section" open>
          <summary>
            金额范围 <small>{draft.min || draft.max ? "已设置" : "不限"}</small>
          </summary>
          <div className="amount-filter-fields">
            <Field label="币种">
              <select
                value={draft.currency}
                disabled={!!scope}
                onChange={(e) =>
                  setDraft((f) => ({
                    ...f,
                    currency: e.target.value,
                    min: "",
                    max: "",
                  }))
                }
              >
                <option value="">所有币种</option>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="最低金额">
                <AmountInput
                  currency={draft.currency || book.currency}
                  value={draft.min}
                  placeholder="不限"
                  onValueChange={(value) => change("min", value)}
                />
              </Field>
              <Field label="最高金额">
                <AmountInput
                  currency={draft.currency || book.currency}
                  value={draft.max}
                  placeholder="不限"
                  onValueChange={(value) => change("max", value)}
                />
              </Field>
            </div>
          </div>
        </details>
        <ErrorMessage message={error} />
        <div className="dialog-footer">
          <Button
            variant="plain"
            onClick={() =>
              setDraft({ ...emptyFilter(), currency: account?.currency || "" })
            }
          >
            清空
          </Button>
          <Button
            disabled={!!error}
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            查看 {total} 笔
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
