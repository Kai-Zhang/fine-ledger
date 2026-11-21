import { AmountInput } from "./AmountInput.tsx";
import { useState } from "react";
import { useApp } from "../ui/context.tsx";
import {
  Dialog,
  Field,
  Amount,
  Button,
  ErrorMessage,
} from "../ui/components.tsx";
import { decimal, minor } from "../domain/money.ts";
import { entryCurrency, needsSettlement } from "../domain/ledger.ts";
import { postingPreview, confirmPosting } from "../domain/posting.ts";
import type { Entry } from "../domain/types.ts";

export function PostingDialog({ entry }: { entry: Entry }) {
  const app = useApp();
  const [source] = useState(() => structuredClone(entry));
  const currency = app.book.accounts.find(
    (a) => a.id === source.accountId,
  )!.currency;
  const initial = needsSettlement(app.book, source)
    ? undefined
    : source.amountMinor;
  const [amount, setAmount] = useState(
    initial ? decimal(initial, currency) : "",
  );
  const [custom, setCustom] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  let values: string[] = [];
  try {
    values = postingPreview(
      app.book,
      source,
      minor(amount, currency),
    ).splits.map((s) => decimal(s.amountMinor, currency));
  } catch {
    /* incomplete input */
  }
  const original = source.originalAmount || {
    currency: entryCurrency(app.book, source),
    amountMinor: source.amountMinor,
  };
  return (
    <Dialog
      title="确认入账"
      onClose={app.close}
      dirty={
        amount !== (initial ? decimal(initial, currency) : "") ||
        custom !== null
      }
    >
      <form
        className="dialog-body posting-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const actual = minor(amount, currency);
            const splits = custom?.map((v) => minor(v, currency));
            setBusy(true);
            if (
              await app.save("确认入账", (book) =>
                confirmPosting(book, source, actual, splits),
              )
            )
              app.close();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="posting-summary">
          <div className="posting-reference">
            <span>原始金额</span>
            <Amount
              value={original.amountMinor}
              currency={original.currency}
              code
            />
          </div>
          <div className="posting-account">
            <span>记入账户</span>
            <strong>
              {app.book.accounts.find((a) => a.id === source.accountId)?.name}
            </strong>
          </div>
        </div>
        <Field label="实际入账金额">
          <div className="currency-input">
            <AmountInput
              currency={currency}
              aria-label={`实际入账金额 · ${currency}`}
              autoFocus
              value={amount}
              onBeginEdit={() => () => {
                setAmount(amount);
                setCustom(custom);
              }}
              onValueChange={(value) => {
                setAmount(value);
                setCustom(null);
              }}
              placeholder="填写银行实际金额"
            />
            <span>{currency}</span>
          </div>
        </Field>
        {source.splits.length > 1 && (
          <div className="posting-splits">
            <div className="posting-split-heading">
              <span>类目分配</span>
              <small>按原比例，可调整</small>
            </div>
            {source.splits.map((s, i) => (
              <Field
                key={s.id}
                label={
                  app.book.categories.find((c) => c.id === s.categoryId)
                    ?.name || "历史类目"
                }
              >
                <div className="currency-input">
                  <AmountInput
                    currency={currency}
                    aria-label={`入账类目 ${i + 1} 金额`}
                    value={(custom || values)[i] || ""}
                    onValueChange={(value) => {
                      const next = [...(custom || values)];
                      next[i] = value;
                      setCustom(next);
                    }}
                  />
                  <span>{currency}</span>
                </div>
              </Field>
            ))}
          </div>
        )}
        <ErrorMessage message={error} />
        <div className="dialog-footer">
          <Button
            variant="plain"
            type="button"
            onClick={() =>
              app.leave(
                app.close,
                amount !== (initial ? decimal(initial, currency) : "") ||
                  custom !== null,
              )
            }
          >
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "正在保存…" : "确认入账"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
