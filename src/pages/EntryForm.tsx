import {
  AmountInput,
  activateAmountInput,
} from "../components/AmountInput.tsx";
import { descriptionSuggestions } from "../domain/description-view.ts";
import { useReferenceRates } from "../reports/useReferenceRates.ts";
import { referenceRateLookup } from "../domain/reference-rates.ts";
import { sortedProjects } from "../domain/organization.ts";
import { categoryColor } from "../ui/category-color.ts";
import {
  allocateSplits,
  descriptionSplits,
} from "../domain/split-allocation.ts";
import { DescriptionSuggestions } from "../components/DescriptionSuggestions.tsx";
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
  entryCurrency,
  balance,
  remainingRefund,
  refundOriginalId,
  refundTotals,
  upsertEntry,
} from "../domain/ledger.ts";
import { uid, type Split, type Entry } from "../domain/types.ts";
import {
  currencies,
  digits,
  minor,
  decimal,
  money,
  rateText,
  roundedRatio,
} from "../domain/money.ts";
import { localInput, dateToISO } from "../domain/dates.ts";
import { kindLabel } from "../components/Transactions.tsx";
type FormSplit = {
  id: string;
  categoryId: string;
  amount: string;
  projectId?: string;
  note?: string;
  locked?: boolean;
};
export function EntryForm() {
  const app = useApp(),
    { book, route } = app;
  const editorZone = useRef(book.timeZone).current;
  const existing = book.entries.find((e) => e.id === route.id),
    original = book.entries.find(
      (e) =>
        e.id === (route.originalId || (existing && refundOriginalId(existing))),
    );
  const difference = original ? remainingRefund(book, original.id) : null;
  const suggestedRefund =
    difference !== null && difference > 0n ? difference : null;
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
    [inputCurrency, setInputCurrency] = useState(entryCurrency(book, initial)),
    [originCurrency, setOriginCurrency] = useState(
      initial.originalAmount?.currency || "JPY",
    ),
    [originValue, setOriginValue] = useState(
      initial.originalAmount
        ? decimal(
            initial.originalAmount.amountMinor,
            initial.originalAmount.currency,
          )
        : "",
    ),
    [toId, setTo] = useState(initial.toAccountId || ""),
    [amount, setAmount] = useState(
      existing
        ? decimal(
            initial.kind === "adjustment"
              ? balance(book, initial.accountId, initial.occurredAt).toString()
              : initial.amountMinor,
            entryCurrency(book, initial),
          )
        : original && suggestedRefund !== null
          ? decimal(
              suggestedRefund.toString(),
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
    [when, setWhen] = useState(localInput(initial.occurredAt, editorZone)),
    [receivedAt, setReceivedAt] = useState(
      localInput(initial.receivedAt || initial.occurredAt, editorZone),
    ),
    [separateDate, setSeparateDate] = useState(
      !!initial.receivedAt && initial.receivedAt !== initial.occurredAt,
    ),
    [note, setNote] = useState(initial.note || ""),
    [extras, setExtras] = useState(
      !!book.entries.find((e) => e.transferId === initial.id && !e.deletedAt) ||
        !!initial.note ||
        initial.splits.some((s) => !!s.projectId) ||
        !!original?.splits.some((s) => !!s.projectId),
    ),
    [focused, setFocused] = useState(false),
    [showSuggestions, setShowSuggestions] = useState(false),
    [picker, setPicker] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [splitMode, setSplitMode] = useState(
      initial.splits.length > 1 || (!!original && original.splits.length > 1),
    );
  const account = book.accounts.find((a) => a.id === accountId),
    accountCurrency = account?.currency || book.currency,
    currency = ["expense", "income"].includes(kind)
      ? inputCurrency
      : accountCurrency,
    foreign = currency !== accountCurrency,
    to = book.accounts.find((a) => a.id === toId),
    catManual = useRef(!!existing),
    amountRef = useRef<HTMLInputElement>(null),
    splitAmountRefs = useRef(new Map<string, HTMLInputElement>()),
    descriptionRef = useRef<HTMLInputElement>(null),
    secondsEdited = useRef(false),
    receivedSecondsEdited = useRef(false);
  const transferCurrency =
    kind === "transfer" && to?.currency !== currency ? to?.currency : undefined;
  const [transferDriver, setTransferDriver] = useState<"out" | "in" | null>(
    null,
  );
  const quotes = useReferenceRates(
    book.currency,
    transferCurrency ? [currency, transferCurrency] : [],
    undefined,
    undefined,
    !app.preview,
  );
  const reference = useMemo(() => {
    if (!transferCurrency) return null;
    const lookup = referenceRateLookup(
      [...app.currentReferenceQuotes, ...quotes],
      book.currency,
      book.timeZone,
    );
    const now = new Date().toISOString();
    const inBase = (c: string) =>
      c === book.currency ? { n: 1n, d: 1n } : lookup(c, now);
    const from = inBase(currency),
      to = inBase(transferCurrency);
    return from && to ? { n: from.n * to.d, d: from.d * to.n } : null;
  }, [
    app.currentReferenceQuotes,
    quotes,
    book.currency,
    book.timeZone,
    currency,
    transferCurrency,
  ]);
  function positiveMinor(raw: string, unit: string) {
    try {
      const value = BigInt(minor(raw, unit));
      return value > 0n ? value : 0n;
    } catch {
      return 0n;
    }
  }
  const fromAmount = transferCurrency ? positiveMinor(amount, currency) : 0n;
  const toAmount = transferCurrency
    ? positiveMinor(received, transferCurrency)
    : 0n;
  useEffect(() => {
    if (app.preview || !reference || !transferCurrency || !transferDriver)
      return;
    if (transferDriver === "out") {
      const next = roundedRatio(fromAmount, reference.n, reference.d);
      setReceived(next > 0n ? decimal(next.toString(), transferCurrency) : "");
    } else {
      const next = roundedRatio(toAmount, reference.d, reference.n);
      setAmount(next > 0n ? decimal(next.toString(), currency) : "");
    }
  }, [
    reference,
    transferCurrency,
    transferDriver,
    fromAmount,
    toAmount,
    currency,
    app.preview,
  ]);
  const manualRate = !transferDriver && fromAmount > 0n && toAmount > 0n;
  const displayedRate =
    transferCurrency &&
    (manualRate
      ? rateText(fromAmount, toAmount, currency, transferCurrency)
      : reference &&
        rateText(reference.d, reference.n, currency, transferCurrency));
  const currencySelection = useRef(inputCurrency);
  currencySelection.current = inputCurrency;
  function changeInputCurrency(next: string) {
    // Native iOS pickers can emit input before change. Handle the first event,
    // and never reset a typed amount again when the trailing change arrives.
    if (next === currencySelection.current) return;
    currencySelection.current = next;
    setInputCurrency(next);
    setAmount("");
    setSplits((rows) =>
      rows.map((row) => ({ ...row, amount: "", locked: false })),
    );
  }
  const [splits, setSplits] = useState<FormSplit[]>(() => {
    if (initial.splits.length)
      return initial.splits.map((s) => ({
        ...s,
        amount: decimal(s.amountMinor, currency),
      }));
    if (original) {
      const amounts = allocateSplits(
        suggestedRefund || 0n,
        original.splits.map((s) => ({ id: s.id, amountMinor: "0" })),
      );
      return original.splits.map((s, i) => ({
        ...s,
        id: uid(),
        amount: suggestedRefund === null ? "" : decimal(amounts[i], currency),
      }));
    }
    return [{ id: uid(), categoryId: "", amount: "" }];
  });
  const initialProjects = [
    ...new Set(initial.splits.map((s) => s.projectId || "")),
  ];
  const [project, setProject] = useState(
    original
      ? [...new Set(original.splits.map((s) => s.projectId || ""))].length > 1
        ? "__legacy_mixed__"
        : original.splits[0]?.projectId || ""
      : initialProjects.length > 1
        ? "__legacy_mixed__"
        : initial.splits[0]?.projectId || "",
  );
  const [initialFee] = useState(() =>
    book.entries.find((e) => e.transferId === initial.id && !e.deletedAt),
  );
  const [feeId] = useState(() => initialFee?.id || uid());
  const [fee, setFee] = useState(
    initialFee ? decimal(initialFee.amountMinor, accountCurrency) : "",
  );
  const [feeCategory, setFeeCategory] = useState(
    initialFee?.splits[0]?.categoryId || "",
  );
  const [feePicker, setFeePicker] = useState(false);
  const [allocationError, setAllocationError] = useState("");
  function distribute(rows: FormSplit[], rawTotal = amount, editedId?: string) {
    try {
      const values = allocateSplits(
        BigInt(minor(rawTotal || "0", currency)),
        rows.map((s) => ({
          id: s.id,
          locked: s.locked,
          amountMinor: minor(s.amount || "0", currency),
        })),
        editedId,
      );
      setAllocationError("");
      return rows.map((s, i) => ({
        ...s,
        amount: s.id === editedId ? s.amount : decimal(values[i], currency),
      }));
    } catch (e) {
      setAllocationError((e as Error).message);
      return rows;
    }
  }
  function updateTotal(raw: string) {
    setAmount(raw);
    if (kind === "transfer")
      setTransferDriver(!received || transferDriver === "out" ? "out" : null);
    if (splitMode) setSplits(distribute(splits, raw));
  }
  const initialJSON = useRef<string | undefined>(undefined),
    formJSON = JSON.stringify({
      inputCurrency,
      originCurrency,
      originValue,
      fee,
      feeCategory,
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
      project,
    });
  if (initialJSON.current === undefined) initialJSON.current = formJSON;
  useEffect(() => {
    if (app.preview) return;
    app.setDirty(formJSON !== initialJSON.current);
    return () => app.setDirty(false);
  }, [formJSON]);
  useEffect(() => {
    if (!app.preview && !existing && !original)
      activateAmountInput(amountRef.current);
  }, []);
  const suggestions = useMemo(
    () => descriptionSuggestions(book, kind, description),
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
    if (!catManual.current) {
      const template = descriptionSplits(book, e, total > 0n ? total : 0n);
      setSplits(
        template.map((row) => ({
          ...row,
          amount: decimal(row.amountMinor, currency),
        })),
      );
      setSplitMode(template.length > 1);
      setAllocationError("");
      if (template.some((row) => !row.categoryId) && e.splits.length)
        app.toast("部分历史类目已归档或不可用，请重新选择。");
    }
    setFocused(false);
    setShowSuggestions(false);
    descriptionRef.current?.blur();
    if (!amount) activateAmountInput(amountRef.current);
  }
  function switchKind(value: Entry["kind"]) {
    if (value === kind) return;
    setKind(value);
    setInputCurrency(accountCurrency);
    setAmount("");
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
        editorZone,
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
            projectId:
              project === "__legacy_mixed__"
                ? s.projectId
                : project || undefined,
            note: s.note,
          }))
        : [];
      const value: Entry = {
        ...initial,
        kind,
        accountId,
        toAccountId: kind === "transfer" ? toId : undefined,
        amountMinor,
        amountCurrency: foreign
          ? currency
          : initial.amountCurrency
            ? accountCurrency
            : undefined,
        originalAmount: foreign
          ? { currency, amountMinor }
          : originValue && ["expense", "income"].includes(kind)
            ? {
                currency: originCurrency,
                amountMinor: minor(originValue, originCurrency),
              }
            : undefined,
        posted: foreign ? false : initial.posted,
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
                editorZone,
              )
            : undefined,
        note: note.trim(),
        splits: parts,
        originalId:
          kind === "refund"
            ? original?.id || refundOriginalId(initial)
            : undefined,
        refundReference: undefined,
      };
      setBusy(true);
      if (
        await app.save(existing ? "编辑交易" : kindLabel[kind], (b) => {
          upsertEntry(b, value);
          if (kind === "transfer" && fee.trim()) {
            const feeMinor = minor(fee, accountCurrency);
            const feeEntry: Entry = {
              ...(initialFee || newEntry(accountId, "expense")),
              id: feeId,
              accountId,
              amountMinor: feeMinor,
              description:
                initialFee?.description || `${value.description}手续费`,
              occurredAt: at,
              posted: initialFee?.posted ?? value.posted,
              transferId: value.id,
              splits: [
                {
                  id: initialFee?.splits[0]?.id || uid(),
                  categoryId: feeCategory,
                  amountMinor: feeMinor,
                },
              ],
            };
            upsertEntry(b, feeEntry);
          } else if (kind === "transfer" && initialFee) {
            const currentFee = b.entries.find((e) => e.id === initialFee.id);
            if (!currentFee || currentFee.revision !== initialFee.revision)
              throw Error("关联手续费已更新，请重新打开");
            currentFee.deletedAt = new Date().toISOString();
            currentFee.revision++;
          }
        })
      ) {
        app.setDirty(false);
        app.toast("已保存到本机");
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
          <div
            className="compact-segments entry-types"
            role="group"
            aria-label="交易类型"
          >
            {(["expense", "income", "transfer"] as const).map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={kind === k}
                onClick={() => switchKind(k)}
              >
                <span>{kindLabel[k]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="entry-amount-block">
          <div className="entry-amount-heading">
            <label htmlFor="entry-amount">
              {kind === "adjustment"
                ? "实际余额"
                : kind === "transfer"
                  ? "转出金额"
                  : kind === "refund"
                    ? "退款金额"
                    : kindLabel[kind] + "金额"}
            </label>
          </div>
          <div className="entry-amount-row">
            <AmountInput
              currency={currency}
              id="entry-amount"
              ref={amountRef}
              allowNegative={kind === "adjustment"}
              value={amount}
              onBeginEdit={() => () => {
                setAmount(amount);
                setSplits(splits);
                setReceived(received);
                setTransferDriver(transferDriver);
                setAllocationError(allocationError);
              }}
              onValueChange={(value) => updateTotal(value)}
              placeholder={digits(currency) === 0 ? "0" : "0.00"}
              autoComplete="off"
              aria-label="金额"
            />
            {["expense", "income"].includes(kind) ? (
              <select
                className="entry-currency"
                aria-label="金额币种"
                value={currency}
                onInput={(e) => changeInputCurrency(e.currentTarget.value)}
                onChange={(e) => changeInputCurrency(e.currentTarget.value)}
              >
                {[
                  ...new Set([accountCurrency, ...currencies, inputCurrency]),
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            ) : (
              <span className="entry-currency-code">{currency}</span>
            )}
          </div>
          {foreign && (
            <p className="entry-settlement-note" role="status">
              {accountCurrency} 入账金额待确认
            </p>
          )}
        </div>
        {!foreign &&
          existing?.originalAmount &&
          ["expense", "income"].includes(kind) && (
            <details
              className="original-amount-fields"
              open={initial.originalAmount ? true : undefined}
            >
              <summary>原始消费金额（选填）</summary>
              <div className="form-grid">
                <Field label="原始币种">
                  <select
                    value={originCurrency}
                    onChange={(e) => {
                      setOriginCurrency(e.target.value);
                      setOriginValue("");
                    }}
                  >
                    {[...new Set([originCurrency, ...currencies])].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="原始金额">
                  <AmountInput
                    currency={originCurrency}
                    value={originValue}
                    onValueChange={(value) => setOriginValue(value)}
                    placeholder="可留空"
                  />
                </Field>
              </div>
            </details>
          )}
        {original && (
          <div className="inline-reference">
            <Icon name="RotateCcw" size={17} />
            <span>原记录 · {original.description}</span>
            <Amount
              value={original.amountMinor}
              currency={
                book.accounts.find((a) => a.id === original.accountId)
                  ?.currency || book.currency
              }
              code
            />
            <small>原金额</small>
          </div>
        )}
        {original && refundTotals(book, original.id).length > 0 && (
          <p className="section-note">
            已关联退款：
            {refundTotals(book, original.id)
              .map((total) => money(total.amountMinor, total.currency, true))
              .join(" · ")}
          </p>
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
                if (next.currency !== accountCurrency) {
                  setInputCurrency(next.currency);
                  setFee("");
                  setAmount("");
                  setReceived("");
                  setTransferDriver(null);
                  setSplits(
                    splits.map((s) => ({ ...s, amount: "", locked: false })),
                  );
                }
                setAccount(next.id);
              }}
            >
              <option value="" disabled>
                选择账户
              </option>
              {choices.map((a) => (
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
                <select
                  value={toId}
                  onChange={(e) => {
                    const next = book.accounts.find(
                      (a) => a.id === e.target.value,
                    );
                    if (next?.currency !== to?.currency) {
                      setReceived("");
                      setTransferDriver(amount ? "out" : null);
                    }
                    setTo(e.target.value);
                  }}
                >
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
                    <AmountInput
                      currency={to.currency}
                      value={received}
                      onBeginEdit={() => () => {
                        setReceived(received);
                        setTransferDriver(transferDriver);
                      }}
                      onValueChange={(value) => {
                        setReceived(value);
                        setTransferDriver(
                          !amount || transferDriver === "in" ? "in" : null,
                        );
                      }}
                      placeholder="银行实际到账金额"
                    />
                  </Field>
                  <div className="rate-line">
                    <span>{manualRate ? "实际汇率" : "参考汇率"}</span>
                    <span>
                      {displayedRate
                        ? `1 ${currency} = ${displayedRate} ${transferCurrency}`
                        : "暂无报价"}
                    </span>
                  </div>
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
              onBlur={() => {
                setFocused(false);
                setShowSuggestions(false);
              }}
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
          {showSuggestions && (
            <DescriptionSuggestions
              items={suggestions}
              active={focused}
              onPick={pickDescription}
              preview={app.preview}
            />
          )}
          {["expense", "income", "refund"].includes(kind) && (
            <div className="category-field">
              <div className="split-header">
                <span className="field-label">类目</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={async () => {
                    catManual.current = true;
                    if (splitMode) {
                      if (
                        splits.length > 1 &&
                        !(await app.confirm({
                          title: "合并为单类目？",
                          message:
                            project === "__legacy_mixed__"
                              ? "拆分金额将合并到第一个类目，并使用该项的项目。"
                              : "拆分金额将合并到第一个类目。",
                          label: "合并",
                        }))
                      )
                        return;
                      if (project === "__legacy_mixed__")
                        setProject(splits[0]?.projectId || "");
                      setSplits([{ ...splits[0], amount: "" }]);
                      setSplitMode(false);
                    } else {
                      setSplits(
                        distribute([
                          { ...splits[0], amount: amount || "", locked: false },
                          {
                            id: uid(),
                            categoryId: "",
                            amount: "",
                            locked: false,
                          },
                        ]),
                      );
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
                      <span
                        className="category-ink"
                        style={categoryColor(c?.color)}
                      >
                        <Icon name={c?.icon || "Tag"} />
                      </span>
                      <span>{c?.name || "选择类目"}</span>
                      <Icon name="ChevronRight" size={16} />
                    </button>
                    {splitMode && (
                      <>
                        <AmountInput
                          currency={currency}
                          aria-label={`第 ${i + 1} 个类目金额`}
                          placeholder="金额"
                          value={s.amount}
                          onBeginEdit={() => () => {
                            setSplits(splits);
                            setAllocationError(allocationError);
                          }}
                          disabled={!!s.locked}
                          ref={(node) => {
                            if (node) splitAmountRefs.current.set(s.id, node);
                            else splitAmountRefs.current.delete(s.id);
                          }}
                          onCommit={(value, target) => {
                            if (!value) throw Error("请填写类目金额");
                            // The explicit lock button owns its toggle; do not toggle twice.
                            if (
                              target
                                ?.closest(".split-lock")
                                ?.closest(".split-row") ===
                              splitAmountRefs.current
                                .get(s.id)
                                ?.closest(".split-row")
                            )
                              return;
                            allocateSplits(
                              BigInt(minor(amount || "0", currency)),
                              splits.map((x) => ({
                                id: x.id,
                                amountMinor: minor(
                                  x.id === s.id ? value : x.amount || "0",
                                  currency,
                                ),
                                locked: x.locked || x.id === s.id,
                              })),
                            );
                            setSplits((rows) =>
                              rows.map((x) =>
                                x.id === s.id
                                  ? { ...x, amount: value, locked: true }
                                  : x,
                              ),
                            );
                          }}
                          onValueChange={(value) =>
                            setSplits(
                              distribute(
                                splits.map((x, j) =>
                                  j === i ? { ...x, amount: value } : x,
                                ),
                                amount,
                                s.id,
                              ),
                            )
                          }
                        />
                        <IconButton
                          className="split-lock"
                          name={s.locked ? "LockKeyhole" : "LockKeyholeOpen"}
                          label={`${s.locked ? "解锁" : "锁定"}第 ${i + 1} 个类目金额`}
                          aria-pressed={!!s.locked}
                          onClick={() =>
                            setSplits(
                              s.locked
                                ? distribute(
                                    splits.map((x, j) =>
                                      j === i ? { ...x, locked: false } : x,
                                    ),
                                  )
                                : splits.map((x, j) =>
                                    j === i ? { ...x, locked: true } : x,
                                  ),
                            )
                          }
                        />
                        <IconButton
                          name="X"
                          label={`移除第 ${i + 1} 个类目`}
                          disabled={splits.length <= 2}
                          onClick={() =>
                            setSplits(
                              distribute(splits.filter((_, j) => j !== i)),
                            )
                          }
                        />
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
                      setSplits(
                        distribute([
                          ...splits,
                          {
                            id: uid(),
                            categoryId: "",
                            amount: "",
                            locked: false,
                          },
                        ]),
                      )
                    }
                  >
                    <Icon name="Plus" size={16} />
                    添加类目
                  </button>
                  <ErrorMessage message={allocationError} />
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
            <span>{kind === "transfer" ? "手续费与备注" : "项目与备注"}</span>
            <Icon name={extras ? "ChevronDown" : "ChevronRight"} size={17} />
          </button>
          {extras && (
            <div className="optional-fields">
              {kind === "transfer" && (
                <>
                  <Field label={`独立手续费 · ${accountCurrency}`} optional>
                    <AmountInput
                      currency={accountCurrency}
                      value={fee}
                      onValueChange={(value) => setFee(value)}
                      placeholder="本金之外的费用，可留空"
                    />
                  </Field>
                  {(fee || initialFee) && (
                    <Field label="手续费类目">
                      <button
                        type="button"
                        className="disclosure-row"
                        onClick={() => setFeePicker(true)}
                      >
                        {book.categories.find((c) => c.id === feeCategory)
                          ?.name || "选择费用类目"}
                        <Icon name="ChevronRight" size={16} />
                      </button>
                    </Field>
                  )}
                  <p className="muted compact-note">
                    转出金额只填本金；手续费另计支出，与本次转账关联。清空已有手续费会删除对应费用记录。
                  </p>
                </>
              )}

              {["expense", "income", "refund"].includes(kind) && (
                <Field label="项目" optional>
                  <select
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  >
                    <option value="">无项目</option>
                    {project === "__legacy_mixed__" && (
                      <option value="__legacy_mixed__">
                        保留历史多项目分配
                      </option>
                    )}
                    {sortedProjects(book.projects)
                      .filter((p) => !p.archived || p.id === project)
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
            {busy
              ? "正在保存…"
              : foreign && !existing
                ? "保存为未入账"
                : existing
                  ? "保存修改"
                  : "保存"}
          </Button>
        </div>
      </form>
      {feePicker && (
        <CategoryPicker
          kind="expense"
          selected={feeCategory}
          onSelect={setFeeCategory}
          onClose={() => setFeePicker(false)}
        />
      )}
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
    </>
  );
}
