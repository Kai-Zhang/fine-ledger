import { DateTimeField } from "../components/DateTimeField.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  Button,
  IconButton,
  Field,
  Amount,
  ErrorMessage,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { CategoryPicker } from "../components/CategoryPicker.tsx";
import { newEntry } from "../storage/repository.ts";
import {
  balance,
  descriptions,
  remainingRefund,
  upsertEntry,
} from "../domain/ledger.ts";
import { uid, type Split, type Entry } from "../domain/types.ts";
import { minor, decimal, money, rateText } from "../domain/money.ts";
import { localInput, dateToISO } from "../domain/dates.ts";
import { kindLabel } from "../components/Transactions.tsx";
type FormSplit = {
  id: string;
  categoryId: string;
  amount: string;
  projectId?: string;
  note?: string;
};
export function EntryForm() {
  const app = useApp(),
    { book, route } = app;
  const original = book.entries.find((e) => e.id === route.originalId),
    existing = book.entries.find((e) => e.id === route.id);
  const initial = useRef<Entry>(
    existing
      ? structuredClone(existing)
      : newEntry(
          route.accountId ||
            original?.accountId ||
            book.accounts.find((a) => !a.archived)?.id ||
            "",
          route.kind || "expense",
        ),
  ).current;
  const [kind, setKind] = useState(initial.kind),
    [accountId, setAccount] = useState(initial.accountId),
    [toId, setTo] = useState(initial.toAccountId || ""),
    [amount, setAmount] = useState(
      existing
        ? decimal(
            initial.kind === "adjustment"
              ? balance(book, initial.accountId, initial.occurredAt).toString()
              : initial.amountMinor,
            book.accounts.find((a) => a.id === initial.accountId)!.currency,
          )
        : original
          ? decimal(
              remainingRefund(book, original.id).toString(),
              book.accounts.find((a) => a.id === initial.accountId)!.currency,
            )
          : "",
    ),
    [received, setReceived] = useState(
      existing && initial.receivedMinor
        ? decimal(
            initial.receivedMinor,
            book.accounts.find((a) => a.id === initial.toAccountId)!.currency,
          )
        : "",
    ),
    [description, setDescription] = useState(
      initial.description || (original ? `${original.description}退款` : ""),
    ),
    [when, setWhen] = useState(localInput(initial.occurredAt, book.timeZone)),
    [receivedAt, setReceivedAt] = useState(
      localInput(initial.receivedAt || initial.occurredAt, book.timeZone),
    ),
    [separateDate, setSeparateDate] = useState(
      !!initial.receivedAt && initial.receivedAt !== initial.occurredAt,
    ),
    [note, setNote] = useState(initial.note || ""),
    [extras, setExtras] = useState(!!initial.note),
    [focused, setFocused] = useState(false),
    [showSuggestions, setShowSuggestions] = useState(false),
    [picker, setPicker] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [splitMode, setSplitMode] = useState(
      initial.splits.length > 1 || (!!original && original.splits.length > 1),
    );
  const account = book.accounts.find((a) => a.id === accountId),
    currency = account?.currency || book.currency,
    to = book.accounts.find((a) => a.id === toId),
    catManual = useRef(!!existing),
    amountRef = useRef<HTMLInputElement>(null),
    descriptionRef = useRef<HTMLInputElement>(null),
    secondsEdited = useRef(false),
    receivedSecondsEdited = useRef(false);
  const [splits, setSplits] = useState<FormSplit[]>(() =>
    initial.splits.length
      ? initial.splits.map((s) => ({
          ...s,
          amount: decimal(s.amountMinor, currency),
        }))
      : original
        ? original.splits.map((s) => ({
            ...s,
            id: uid(),
            amount: decimal(s.amountMinor, currency),
          }))
        : [{ id: uid(), categoryId: "", amount: "" }],
  );
  const initialJSON = useRef<string | undefined>(undefined),
    formJSON = JSON.stringify({
      kind,
      accountId,
      toId,
      amount,
      received,
      description,
      when,
      receivedAt,
      separateDate,
      note,
      splits,
      splitMode,
    });
  if (initialJSON.current === undefined) initialJSON.current = formJSON;
  useEffect(() => {
    if (app.preview) return;
    app.setDirty(formJSON !== initialJSON.current);
    return () => app.setDirty(false);
  }, [formJSON]);
  useEffect(() => {
    if (!app.preview && !existing && !original) amountRef.current?.focus();
  }, []);
  const suggestions = useMemo(
    () => descriptions(book, kind, description),
    [book, kind, description],
  );
  let total = 0n,
    allocated = 0n;
  try {
    total = BigInt(minor(amount || "0", currency));
    allocated = splits.reduce(
      (a, s) => a + BigInt(minor(s.amount || "0", currency)),
      0n,
    );
  } catch {}
  function pickDescription(e: Entry) {
    setDescription(e.description);
    if (!catManual.current && !splitMode) {
      setSplits([
        {
          id: splits[0]?.id || uid(),
          categoryId: book.categories.some(
            (c) => c.id === e.splits[0]?.categoryId && !c.archived,
          )
            ? e.splits[0].categoryId
            : "",
          amount: "",
          projectId: splits[0]?.projectId,
        },
      ]);
    }
    setFocused(false);
    setShowSuggestions(false);
    descriptionRef.current?.blur();
    if (!amount) amountRef.current?.focus();
  }
  function switchKind(value: Entry["kind"]) {
    if (value === kind) return;
    setKind(value);
    catManual.current = false;
    setSplitMode(false);
    setSplits([{ id: uid(), categoryId: "", amount: "" }]);
    setError("");
  }
  const choices = book.accounts.filter(
    (a) =>
      !a.archived || a.id === initial.accountId || a.id === initial.toAccountId,
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFocused(false);
    setError("");
    try {
      if (!account) throw Error("请选择账户");
      const at = dateToISO(
        when,
        secondsEdited.current ? undefined : initial.occurredAt,
        book.timeZone,
      );
      let amountMinor = minor(amount, currency);
      if (kind === "adjustment")
        amountMinor = (
          BigInt(amountMinor) - balance(book, accountId, at, existing?.id)
        ).toString();
      const parts: Split[] = ["expense", "income", "refund"].includes(kind)
        ? splits.map((s, i) => ({
            id: s.id,
            categoryId: s.categoryId,
            amountMinor: splitMode ? minor(s.amount, currency) : amountMinor,
            projectId: s.projectId,
            note: s.note,
          }))
        : [];
      const value: Entry = {
        ...initial,
        kind,
        accountId,
        toAccountId: kind === "transfer" ? toId : undefined,
        amountMinor,
        receivedMinor:
          kind === "transfer"
            ? to?.currency === currency
              ? amountMinor
              : minor(received, to?.currency || book.currency)
            : undefined,
        description:
          description.trim() ||
          (kind === "transfer" && account && to
            ? `${account.name} → ${to.name}`
            : ""),
        occurredAt: at,
        receivedAt:
          kind === "transfer" && separateDate
            ? dateToISO(
                receivedAt,
                receivedSecondsEdited.current ? undefined : initial.receivedAt,
                book.timeZone,
              )
            : undefined,
        note: note.trim(),
        splits: parts,
        originalId: original?.id || initial.originalId,
      };
      setBusy(true);
      if (
        await app.save(existing ? "编辑交易" : kindLabel[kind], (b) =>
          upsertEntry(b, value),
        )
      ) {
        app.setDirty(false);
        app.back();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title={
          existing
            ? "编辑交易"
            : kind === "refund"
              ? "退款"
              : kind === "adjustment"
                ? "调整余额"
                : "记一笔"
        }
        back
      >
        {existing && (
          <span className={`status-badge ${existing.posted ? "" : "pending"}`}>
            {existing.posted ? "已入账" : "未入账"}
          </span>
        )}
      </Header>
      <form
        className="entry-form page-content"
        onSubmit={submit}
        id="entry-form"
        noValidate
      >
        {!existing && !["refund", "adjustment"].includes(kind) && (
          <div className="segmented entry-types">
            {(["expense", "income", "transfer"] as const).map((k) => (
              <button
                type="button"
                key={k}
                className={kind === k ? "selected" : ""}
                onClick={() => switchKind(k)}
              >
                {kindLabel[k]}
              </button>
            ))}
          </div>
        )}
        <div className="entry-amount-block">
          <label htmlFor="entry-amount">
            {kind === "adjustment"
              ? "实际余额"
              : kind === "transfer"
                ? "转出金额"
                : kind === "refund"
                  ? "退款金额"
                  : kindLabel[kind] + "金额"}
            <span>{currency}</span>
          </label>
          <input
            id="entry-amount"
            ref={amountRef}
            inputMode={kind === "adjustment" ? "text" : "decimal"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
            aria-label="金额"
          />
        </div>
        {original && (
          <div className="inline-reference">
            <Icon name="RotateCcw" size={17} />
            <span>原消费 · {original.description}</span>
            <Amount
              value={remainingRefund(book, original.id)}
              currency={currency}
            />
            <small>可退</small>
          </div>
        )}
        <div className="form-surface">
          <Field
            label={
              kind === "transfer"
                ? "转出账户"
                : kind === "refund"
                  ? "退款到账"
                  : "账户"
            }
          >
            <select
              value={accountId}
              onChange={(e) => {
                const next = book.accounts.find(
                  (a) => a.id === e.target.value,
                )!;
                if (next.currency !== currency) {
                  setAmount("");
                  setSplits(splits.map((s) => ({ ...s, amount: "" })));
                }
                setAccount(next.id);
              }}
            >
              <option value="" disabled>
                选择账户
              </option>
              {choices
                .filter((a) => !original || a.currency === currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                    {a.archived ? "（已归档）" : ""}
                  </option>
                ))}
            </select>
          </Field>
          {kind === "transfer" && (
            <>
              <Field label="转入账户">
                <select value={toId} onChange={(e) => setTo(e.target.value)}>
                  <option value="">选择转入账户</option>
                  {choices
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.currency}
                      </option>
                    ))}
                </select>
              </Field>
              {to && to.currency !== currency && (
                <>
                  <Field label={`转入金额 · ${to.currency}`}>
                    <input
                      inputMode="decimal"
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                      placeholder="银行实际到账金额"
                    />
                  </Field>
                  {total > 0n &&
                    (() => {
                      try {
                        const v = minor(received, to.currency);
                        return BigInt(v) > 0n ? (
                          <div className="rate-line">
                            1 {currency} ={" "}
                            {rateText(
                              total.toString(),
                              v,
                              currency,
                              to.currency,
                            )}{" "}
                            {to.currency}
                          </div>
                        ) : null;
                      } catch {
                        return null;
                      }
                    })()}
                </>
              )}
            </>
          )}
          <Field label={kind === "adjustment" ? "调整原因" : "描述"}>
            <input
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onFocus={() => {
                setFocused(true);
                setShowSuggestions(true);
              }}
              onBlur={() => setFocused(false)}
              onCompositionStart={() => {}}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.nativeEvent.isComposing || e.keyCode === 229)
                )
                  e.preventDefault();
                else if (e.key === "Enter") {
                  e.preventDefault();
                  setFocused(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder={
                kind === "transfer" ? "可按账户自动生成" : "这笔交易是什么"
              }
              autoComplete="off"
              maxLength={120}
            />
          </Field>
          {showSuggestions && suggestions.length > 0 && (
            <div className="suggestions-inline">
              {suggestions.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pickDescription(e)}
                >
                  {e.description}
                </button>
              ))}
            </div>
          )}
          {["expense", "income", "refund"].includes(kind) && (
            <div className="category-field">
              <div className="split-header">
                <span className="field-label">类目</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    catManual.current = true;
                    if (splitMode) {
                      if (
                        splits.length > 1 &&
                        !window.confirm("合并为一个类目？拆分金额将移除。")
                      )
                        return;
                      setSplits([{ ...splits[0], amount: "" }]);
                      setSplitMode(false);
                    } else {
                      setSplits([
                        { ...splits[0], amount: amount || "" },
                        { id: uid(), categoryId: "", amount: "" },
                      ]);
                      setSplitMode(true);
                    }
                  }}
                >
                  {splitMode ? "合并为单类目" : "拆分类目"}
                </button>
              </div>
              {splits.map((s, i) => {
                const c = book.categories.find((c) => c.id === s.categoryId);
                return (
                  <div className="split-row" key={s.id}>
                    <button
                      type="button"
                      className="category-choice"
                      onClick={() => setPicker(i)}
                    >
                      <span style={{ color: c?.color }}>
                        <Icon name={c?.icon || "Tag"} />
                      </span>
                      <span>{c?.name || "选择类目"}</span>
                      <Icon name="ChevronRight" size={16} />
                    </button>
                    {splitMode && (
                      <>
                        <input
                          aria-label={`第 ${i + 1} 个类目金额`}
                          inputMode="decimal"
                          placeholder="金额"
                          value={s.amount}
                          onChange={(e) =>
                            setSplits(
                              splits.map((x, j) =>
                                j === i ? { ...x, amount: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <IconButton
                          name="X"
                          label={`移除第 ${i + 1} 个类目`}
                          disabled={splits.length <= 2}
                          onClick={() =>
                            setSplits(splits.filter((_, j) => j !== i))
                          }
                        />
                        <select
                          className="split-project"
                          aria-label={`第 ${i + 1} 个类目项目`}
                          value={s.projectId || ""}
                          onChange={(e) =>
                            setSplits(
                              splits.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      projectId: e.target.value || undefined,
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="">无项目</option>
                          {book.projects
                            .filter((p) => !p.archived || p.id === s.projectId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </>
                    )}
                  </div>
                );
              })}
              {splitMode && (
                <>
                  <button
                    type="button"
                    className="text-button add-split"
                    onClick={() =>
                      setSplits([
                        ...splits,
                        { id: uid(), categoryId: "", amount: "" },
                      ])
                    }
                  >
                    <Icon name="Plus" size={16} />
                    添加类目
                  </button>
                  <div
                    className={`split-summary ${total !== allocated ? "warning" : ""}`}
                  >
                    <span>已分配 {money(allocated, currency)}</span>
                    <strong>
                      {total === allocated
                        ? "已分配完成"
                        : `还差 ${money(total - allocated, currency)}`}
                    </strong>
                  </div>
                </>
              )}
            </div>
          )}
          <DateTimeField
            label="时间"
            value={when}
            onChange={setWhen}
            onSecondsEdit={() => {
              secondsEdited.current = true;
            }}
          />
          {kind === "transfer" && (
            <>
              <button
                type="button"
                className="text-button receive-date"
                onClick={() => setSeparateDate(!separateDate)}
              >
                {separateDate ? "使用相同的接收时间" : "单独设置接收时间"}
              </button>
              {separateDate && (
                <DateTimeField
                  label="接收时间"
                  value={receivedAt}
                  onChange={setReceivedAt}
                  onSecondsEdit={() => {
                    receivedSecondsEdited.current = true;
                  }}
                />
              )}
            </>
          )}
          <button
            type="button"
            className="disclosure-row"
            aria-expanded={extras}
            onClick={() => setExtras(!extras)}
          >
            <Icon name="MoreHorizontal" size={18} />
            <span>项目与备注</span>
            <Icon name={extras ? "ChevronDown" : "ChevronRight"} size={17} />
          </button>
          {extras && (
            <div className="optional-fields">
              {!splitMode && ["expense", "income", "refund"].includes(kind) && (
                <Field label="项目" optional>
                  <select
                    value={splits[0]?.projectId || ""}
                    onChange={(e) =>
                      setSplits(
                        splits.map((s, i) =>
                          i === 0
                            ? { ...s, projectId: e.target.value || undefined }
                            : s,
                        ),
                      )
                    }
                  >
                    <option value="">无项目</option>
                    {book.projects
                      .filter((p) => !p.archived)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="备注" optional>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            </div>
          )}
        </div>
        <ErrorMessage message={error} />
        <div className="entry-submit">
          <Button type="submit" disabled={busy}>
            {busy ? "正在保存…" : existing ? "保存修改" : "保存"}
          </Button>
        </div>
      </form>
      {picker !== null && (
        <CategoryPicker
          kind={kind === "income" ? "income" : "expense"}
          selected={splits[picker]?.categoryId}
          onSelect={(id) => {
            catManual.current = true;
            setSplits(
              splits.map((s, i) =>
                i === picker ? { ...s, categoryId: id } : s,
              ),
            );
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {focused && suggestions.length > 0 && (
        <div className="keyboard-suggestions" aria-label="描述候选">
          {suggestions.map((e) => (
            <button
              type="button"
              key={e.id}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pickDescription(e)}
            >
              {e.description}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
