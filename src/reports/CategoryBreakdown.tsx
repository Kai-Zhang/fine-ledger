import { useMemo } from "react";
import type { Book } from "../domain/types.ts";
import type { ReportResult } from "../domain/reporting.ts";
import { ExpenseDonut } from "./ExpenseDonut.tsx";
import {
  categoryPlotColors,
  categoryShare,
  type RingLayer,
} from "./donut-model.ts";
import { plotColor } from "./plot-color.ts";
import { Amount, IconButton, Empty } from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import { money } from "../domain/money.ts";
export function CategoryBreakdown({
  book,
  stats,
  selectedCategory,
  selectedCategoryLayer,
  selectCategory,
  drill,
  income = false,
  onClear,
  hideSummary = false,
}: {
  book: Book;
  stats: ReportResult["stats"];
  selectedCategory: string | null;
  selectedCategoryLayer: RingLayer;
  selectCategory: (id: string, layer: RingLayer) => void;
  drill: (id?: string) => void;
  income?: boolean;
  onClear: () => void;
  hideSummary?: boolean;
}) {
  const positive = [...stats.values].filter(([, v]) => v > 0n),
    negative = [...stats.values].filter(([, v]) => v < 0n),
    positiveTotal = positive.reduce((a, [, n]) => a + n, 0n);
  const plotColors = useMemo(
    () => categoryPlotColors(book.categories),
    [book.categories],
  );
  const parentValues = useMemo(() => {
    const positive = [...stats.values].filter(([, v]) => v > 0n);
    const parents = new Map<
      string,
      {
        id: string;
        name: string;
        icon: string;
        color: string;
        amount: bigint;
        children: { id: string; name: string; icon: string; amount: bigint }[];
      }
    >();
    positive.forEach(([id, n]) => {
      const c = book.categories.find((c) => c.id === id);
      if (!c) return;
      const p = book.categories.find((p) => p.id === c.parentId) || c;
      if (!parents.has(p.id))
        parents.set(p.id, { ...p, amount: 0n, children: [] });
      const parent = parents.get(p.id)!;
      parent.amount += n;
      parent.children.push({ id, name: c.name, icon: c.icon, amount: n });
    });
    return [...parents.values()].sort((a, b) => (a.amount > b.amount ? -1 : 1));
  }, [stats.values, book.categories]);
  const selection = (
    selectedCategoryLayer === "parent"
      ? parentValues
      : parentValues.flatMap((p) => p.children)
  ).find((c) => c.id === selectedCategory);
  const percentage = (amount: bigint) => categoryShare(amount, positiveTotal);
  return (
    <>
      <section
        className={`chart-panel expense-panel ${hideSummary ? "category-only" : ""}`}
      >
        <div className="expense-summary">
          <div>
            <span>
              {stats.missingCount ? "已计入部分 · " : ""}
              {income ? "收入" : "净支出"} <small>{book.currency}</small>
            </span>
            <Amount value={stats.net} currency={book.currency} />
          </div>
          {!income && (
            <div className="expense-breakdown">
              <span>
                支出 <b>{money(stats.expense, book.currency)}</b>
              </span>
              <span>
                退款 <b>{money(stats.refund, book.currency)}</b>
              </span>
            </div>
          )}
        </div>
        {positiveTotal > 0n ? (
          <ExpenseDonut
            groups={parentValues}
            selectedId={selectedCategory}
            layer={selectedCategoryLayer}
            onSelect={selectCategory}
            onClear={onClear}
            currency={book.currency}
            colors={plotColors}
            label={income ? "收入分类" : "支出分类"}
            totalLabel={income ? "收入" : "正向净支出"}
          />
        ) : (
          <Empty
            icon="ChartNoAxesCombined"
            title={
              stats.missingCount
                ? "本期金额不完整"
                : negative.length
                  ? "本期为净退款"
                  : income
                    ? "本期暂无收入"
                    : "本期暂无支出"
            }
          />
        )}
        {positiveTotal > 0n && (
          <div className="chart-selection-detail" aria-live="polite">
            <div>
              <strong>
                {selection
                  ? (() => {
                      const parent = parentValues.find((p) =>
                        p.children.some((c) => c.id === selection.id),
                      );
                      return parent && parent.name !== selection.name
                        ? `${parent.name} / ${selection.name}`
                        : selection.name;
                    })()
                  : "全部正向类别"}
              </strong>
              <small>
                {selection
                  ? `占${income ? "收入" : "正向净支出"} ${percentage(selection.amount)}`
                  : "点按图中类别查看金额与占比"}
              </small>
            </div>
            {selection && (
              <>
                <Amount value={selection.amount} currency={book.currency} />
                <IconButton
                  name="List"
                  label={`查看${selection.name}交易`}
                  onClick={() => drill(selection.id)}
                />
              </>
            )}
          </div>
        )}
        {negative.length > 0 && (
          <p className="compact-note muted">
            环图展示正向支出，净退款单列在下方。
          </p>
        )}
      </section>
      <div className="section-title">
        <h2>分类明细</h2>
        <button className="text-button" onClick={() => drill()}>
          查看交易
          <Icon name="ArrowRight" size={15} />
        </button>
      </div>
      <div className="category-stat-list">
        {parentValues.map((p) => (
          <details key={p.id} className="report-category-group" open>
            <summary>
              <button
                type="button"
                className={`category-parent-main ${selectedCategory === p.id && selectedCategoryLayer === "parent" ? "is-selected" : ""}`}
                aria-label={`选择大类 ${p.name}`}
                aria-pressed={
                  selectedCategory === p.id &&
                  selectedCategoryLayer === "parent"
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectCategory(p.id, "parent");
                }}
              >
                <span
                  className="legend-dot report-category-ink"
                  style={plotColor(plotColors.get(p.id))}
                />
                <span className="category-row-name">
                  <strong>{p.name}</strong>
                  <small>{percentage(p.amount)}</small>
                </span>
                <Amount value={p.amount} currency={book.currency} />
              </button>
              <IconButton
                name="List"
                label={`查看大类${p.name}交易`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drill(p.id);
                }}
              />
              <Icon name="ChevronDown" size={15} />
            </summary>
            {p.children.map((c) => (
              <div key={c.id} className="category-child-row">
                <button
                  type="button"
                  className={`category-child-main ${selectedCategory === c.id && selectedCategoryLayer === "child" ? "is-selected" : ""}`}
                  aria-label={`选择子类 ${c.name}`}
                  aria-pressed={
                    selectedCategory === c.id &&
                    selectedCategoryLayer === "child"
                  }
                  onClick={() => selectCategory(c.id, "child")}
                >
                  <span
                    className="report-category-ink"
                    style={plotColor(plotColors.get(c.id))}
                  >
                    <Icon name={c.icon} size={17} />
                  </span>
                  <span className="category-row-name">
                    <span>{c.name}</span>
                    <small>{percentage(c.amount)}</small>
                  </span>
                  <Amount value={c.amount} currency={book.currency} />
                </button>
                <IconButton
                  name="List"
                  label={`查看子类${c.name}交易`}
                  onClick={() => drill(c.id)}
                />
              </div>
            ))}
          </details>
        ))}
        {negative.map(([id, n]) => (
          <button className="net-refund-row" key={id} onClick={() => drill(id)}>
            <Icon name="RotateCcw" size={18} />
            <span>
              {book.categories.find((c) => c.id === id)?.name} · 净退款
            </span>
            <Amount value={n} currency={book.currency} />
            <Icon name="ChevronRight" size={14} />
          </button>
        ))}
      </div>
    </>
  );
}
