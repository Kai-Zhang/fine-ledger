import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Dialog,
  Button,
  Field,
  ErrorMessage,
  Toggle,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { uid, type Account } from "../domain/types.ts";
import { currencies, minor, decimal } from "../domain/money.ts";
import { localInput, dateToISO } from "../domain/dates.ts";
const types = [
  ["bank", "储蓄卡", "Landmark"],
  ["credit", "信用卡", "CreditCard"],
  ["wallet", "电子钱包", "Wallet"],
  ["cash", "现金", "Banknote"],
  ["investment", "储蓄投资", "Sprout"],
] as const;
export function AccountEditor({
  account,
  groupId,
  onClose,
}: {
  account?: Account;
  groupId?: string;
  onClose: () => void;
}) {
  const { book, save } = useApp(),
    [name, setName] = useState(account?.name || ""),
    [type, setType] = useState(account?.type || "bank"),
    [currency, setCurrency] = useState(account?.currency || book.currency),
    [group, setGroup] = useState(
      account?.groupId || groupId || book.groups[0]?.id || "",
    ),
    [opening, setOpening] = useState(
      account ? decimal(account.openingMinor, account.currency) : "0",
    ),
    [at, setAt] = useState(localInput(account?.openingAt, book.timeZone)),
    [net, setNet] = useState(account?.netWorth !== false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const hasHistory =
    !!account &&
    book.entries.some(
      (e) => e.accountId === account.id || e.toAccountId === account.id,
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!name.trim()) throw Error("请填写账户名称");
      if (!group) throw Error("请先新增分组");
      const amount = minor(opening, currency);
      setBusy(true);
      const ok = await save(account ? "编辑账户" : "新增账户", (b) => {
        if (!b.groups.some((g) => g.id === group))
          throw Error("所选分组不存在");
        const value: Account = {
          id: account?.id || uid(),
          name: name.trim(),
          type,
          currency,
          groupId: group,
          openingMinor: amount,
          openingAt: dateToISO(at, account?.openingAt, book.timeZone),
          icon: types.find((t) => t[0] === type)![2],
          order:
            account?.order ??
            b.accounts.filter((a) => a.groupId === group).length,
          archived: account?.archived || false,
          netWorth: net,
        };
        if (account) {
          const index = b.accounts.findIndex((a) => a.id === account.id);
          if (
            b.entries.some(
              (t) => t.accountId === account.id || t.toAccountId === account.id,
            ) &&
            currency !== account.currency
          )
            throw Error("已有交易的账户不能更改币种");
          b.accounts[index] = value;
        } else b.accounts.push(value);
      });
      if (ok) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={account ? "编辑账户" : "新增账户"} onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <Field label="名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={40}
            placeholder="账户名称"
            required
          />
        </Field>
        <Field label="账户类型">
          <div className="type-options">
            {types.map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={type === value ? "selected" : ""}
                onClick={() => setType(value)}
              >
                <Icon name={icon} />
                {label}
              </button>
            ))}
          </div>
        </Field>
        <div className="form-grid">
          <Field label="分组">
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {book.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="币种">
            <select
              value={currency}
              disabled={hasHistory}
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
        {hasHistory && (
          <p className="muted compact-note">已有交易，账户币种已固定。</p>
        )}
        <Field label="期初余额">
          <input
            inputMode="decimal"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            required
          />
        </Field>
        <Field label="期初日期">
          <input
            type="datetime-local"
            step="1"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <Toggle
          label="纳入总净值"
          checked={net}
          onChange={() => setNet(!net)}
          detail="代管、公司等非个人资金可以关闭"
        />
        <ErrorMessage message={error} />
        <div className="dialog-footer">
          <Button type="button" variant="plain" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} type="submit">
            {busy ? "保存中…" : "保存账户"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function GroupEditor({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}) {
  const { book, save } = useApp(),
    [name, setName] = useState(
      book.groups.find((g) => g.id === id)?.name || "",
    ),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={id ? "重命名分组" : "新增分组"} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          if (
            await save(id ? "重命名分组" : "新增分组", (b) => {
              if (id) {
                b.groups.find((g) => g.id === id)!.name = name.trim();
              } else
                b.groups.push({
                  id: uid(),
                  name: name.trim(),
                  order: b.groups.length,
                });
            })
          )
            onClose();
          setBusy(false);
        }}
      >
        <Field label="分组名称">
          <input
            autoFocus
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <div className="dialog-footer">
          <Button type="button" variant="plain" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy}>保存分组</Button>
        </div>
      </form>
    </Dialog>
  );
}
