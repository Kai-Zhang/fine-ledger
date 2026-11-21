import { AmountInput } from "./AmountInput.tsx";
import { useState, useRef } from "react";
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
import { removeGroup } from "../domain/organization.ts";
import { canChangeAccountCurrency } from "../domain/account-policy.ts";
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
  const app = useApp();
  const editorZone = useRef(app.book.timeZone).current;
  const { book, save } = app,
    [name, setName] = useState(account?.name || ""),
    [type, setType] = useState(account?.type || "bank"),
    [currency, setCurrency] = useState(account?.currency || book.currency),
    [group, setGroup] = useState(account?.groupId ?? groupId ?? ""),
    [opening, setOpening] = useState(
      account ? decimal(account.openingMinor, account.currency) : "0",
    ),
    [at, setAt] = useState(localInput(account?.openingAt, editorZone)),
    [creditLimit, setCreditLimit] = useState(
      account?.creditLimitMinor !== undefined
        ? decimal(account.creditLimitMinor, account.currency)
        : "",
    ),
    [net, setNet] = useState(account?.netWorth !== false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const snapshot = JSON.stringify({
      name,
      type,
      currency,
      group,
      opening,
      creditLimit,
      at,
      net,
    }),
    initialSnapshot = useRef(snapshot),
    dirty = initialSnapshot.current !== snapshot;
  const hasHistory =
    !!account &&
    book.entries.some(
      (e) => e.accountId === account.id || e.toAccountId === account.id,
    );
  const currencyLocked = !canChangeAccountCurrency(account, hasHistory);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!name.trim()) throw Error("请填写账户名称");
      const amount = minor(opening, currency);
      const limit =
        type === "credit" && creditLimit.trim()
          ? minor(creditLimit, currency)
          : undefined;
      if (limit !== undefined && BigInt(limit) < 0n)
        throw Error("信用额度不能为负数");
      setBusy(true);
      const ok = await save(account ? "编辑账户" : "新增账户", (b) => {
        if (group && !b.groups.some((g) => g.id === group))
          throw Error("所选分组不存在");
        const value: Account = {
          id: account?.id || uid(),
          name: name.trim(),
          type,
          currency,
          groupId: group,
          creditLimitMinor: limit,
          openingMinor: amount,
          openingAt: dateToISO(at, account?.openingAt, editorZone),
          icon: types.find((t) => t[0] === type)![2],
          order:
            account && account.groupId === group
              ? account.order
              : b.accounts.filter(
                  (a) => a.id !== account?.id && a.groupId === group,
                ).length,
          archived: account?.archived || false,
          netWorth: net,
        };
        if (limit !== undefined) b.schema = 4;
        if (account) {
          const index = b.accounts.findIndex((a) => a.id === account.id);
          if (
            !canChangeAccountCurrency(
              b.accounts[index],
              b.entries.some(
                (t) =>
                  t.accountId === account.id || t.toAccountId === account.id,
              ),
            ) &&
            currency !== account.currency
          )
            throw Error("已有金额记录的账户不能更改币种");
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
    <Dialog
      title={account ? "编辑账户" : "新增账户"}
      dirty={dirty}
      onClose={onClose}
    >
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
              <option value="">不分组</option>
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
              disabled={currencyLocked}
              onChange={(e) => {
                setCurrency(e.target.value);
                setOpening("0");
                setCreditLimit("");
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        {currencyLocked && (
          <p className="muted compact-note">
            已有交易或期初余额，账户币种已固定。
          </p>
        )}
        {type === "credit" && (
          <Field label={`信用额度 · ${currency}`} optional>
            <AmountInput
              currency={currency}
              value={creditLimit}
              onValueChange={(value) => setCreditLimit(value)}
              placeholder="可留空，不计入净值"
            />
          </Field>
        )}
        <Field label="期初余额">
          <AmountInput
            currency={currency}
            allowNegative
            value={opening}
            onValueChange={(value) => setOpening(value)}
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
          <Button
            type="button"
            variant="plain"
            onClick={() => app.leave(onClose, dirty)}
          >
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
  const app = useApp();
  const { book, save } = app,
    [name, setName] = useState(
      book.groups.find((g) => g.id === id)?.name || "",
    ),
    [busy, setBusy] = useState(false);
  const dirty = name !== (book.groups.find((g) => g.id === id)?.name || "");
  return (
    <Dialog
      title={id ? "重命名分组" : "新增分组"}
      dirty={dirty}
      onClose={onClose}
    >
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
          <Button
            type="button"
            variant="plain"
            onClick={() => app.leave(onClose, dirty)}
          >
            取消
          </Button>
          <Button disabled={busy}>保存分组</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function GroupRemoval({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const app = useApp();
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const group = app.book.groups.find((g) => g.id === id);
  const members = app.book.accounts.filter((a) => a.groupId === id);
  return (
    <Dialog title="删除分组" onClose={onClose} guard={false}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          if (
            await app.save("删除分组", (book) =>
              removeGroup(book, id, destination),
            )
          )
            onClose();
          setBusy(false);
        }}
      >
        <p>删除“{group?.name}”。账户、交易和余额会保留。</p>
        {members.length > 0 && (
          <>
            <p className="section-note">
              组内 {members.length} 个账户（包括已归档账户）将移入所选分组。
            </p>
            <Field label="账户移至">
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                disabled={busy}
              >
                <option value="">未分组</option>
                {app.book.groups
                  .filter((g) => g.id !== id)
                  .sort((a, b) => a.order - b.order)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}
        <div className="dialog-footer">
          <Button
            type="button"
            variant="plain"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button variant="danger" disabled={busy || !group}>
            {busy ? "正在删除…" : "删除分组"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
