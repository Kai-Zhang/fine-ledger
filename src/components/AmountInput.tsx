import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  calculateAmount,
  appendAmountKey,
  IncompleteAmountExpressionError,
} from "../domain/calculator.ts";

// An unfinished expression is an editing state, not a validation banner.
const calculationError = (error: unknown) =>
  error instanceof IncompleteAmountExpressionError
    ? ""
    : (error as Error).message;
import { Icon } from "../ui/icons.tsx";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode" | "readOnly"
> & {
  value: string;
  currency: string;
  onValueChange: (value: string) => void;
  onBeginEdit?: () => () => void;
  allowNegative?: boolean;
  onCommit?: (value: string, target: HTMLElement | null) => void;
  nextLabel?: string;
  onNext?: () => void;
  ref?: Ref<HTMLInputElement>;
};
type Target = { element: HTMLInputElement; options: () => Props };
type Session = Target & {
  expression: string;
  replace: boolean;
  changed: boolean;
  restore: () => void;
  error: string;
};
type Keyboard = {
  open: (target: Target) => void;
  sync: (element: HTMLInputElement) => void;
  paste: (target: Target, text: string) => void;
  cancel: (element: HTMLInputElement) => void;
};
const Context = createContext<Keyboard>(null!);

function isIOS() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// A focused input can show native editing controls on iOS even with inputMode=none.
export function activateAmountInput(
  input: HTMLInputElement | null | undefined,
) {
  if (isIOS()) input?.click();
  else input?.focus({ preventScroll: true });
}

export function AmountKeyboardProvider({ children }: { children: ReactNode }) {
  const current = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const refresh = () =>
    setSession(current.current ? { ...current.current } : null);
  const close = () => {
    current.current = null;
    refresh();
  };
  function finish(target: HTMLElement | null = null, commitUnchanged = false) {
    const s = current.current;
    if (!s) return true;
    const options = s.options();
    try {
      const value = calculateAmount(
        s.expression,
        options.currency,
        options.allowNegative,
      );
      if (s.changed || commitUnchanged) {
        options.onValueChange(value);
        options.onCommit?.(value, target);
      }
      close();
      return true;
    } catch (error) {
      s.error = calculationError(error);
      refresh();
      return false;
    }
  }
  // Keep document handlers current without reinstalling them on each key.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const keyboard = useRef<Keyboard>({
    open(target) {
      if (current.current?.element === target.element) return;
      if (current.current) {
        let ok = false;
        // Capture the next rollback snapshot only after the previous split's
        // lock and recalculated amounts have reached its latest props.
        flushSync(() => {
          ok = finishRef.current(target.element);
        });
        if (!ok) {
          if (!isIOS()) current.current?.element.focus();
          return;
        }
      }
      const options = target.options();
      current.current = {
        ...target,
        expression: options.value.replaceAll("-", "−"),
        replace: true,
        changed: false,
        restore:
          options.onBeginEdit?.() ||
          (() => options.onValueChange(options.value)),
        error: "",
      };
      refresh();
    },
    sync(element) {
      if (current.current?.element === element) refresh();
    },
    paste(target, text) {
      keyboard.open(target);
      const s = current.current;
      if (!s || s.element !== target.element) return;
      s.expression = text
        .trim()
        .replaceAll("*", "×")
        .replaceAll("/", "÷")
        .replaceAll("-", "−");
      s.changed = true;
      s.replace = false;
      try {
        target
          .options()
          .onValueChange(
            calculateAmount(
              s.expression,
              target.options().currency,
              target.options().allowNegative,
            ),
          );
        s.error = "";
      } catch (error) {
        s.error = calculationError(error);
      }
      refresh();
    },
    cancel(element) {
      if (current.current?.element === element) close();
    },
  }).current;
  useEffect(() => {
    let pointerPending = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const press = () => {
      clearTimeout(releaseTimer);
      pointerPending = true;
    };
    const release = () => {
      releaseTimer = setTimeout(() => {
        pointerPending = false;
      }, 400);
    };
    const resetPointer = () => {
      pointerPending = false;
    };
    const outside = (event: MouseEvent | FocusEvent) => {
      // Wait for click completion during pointer input; resizing on pointerdown
      // or its focus event can move a different control beneath the finger.
      if (event.type === "focusin" && pointerPending) return;
      if (event.type === "click") pointerPending = false;
      const s = current.current,
        target = event.target as HTMLElement;
      if (!s || s.element === target || panel.current?.contains(target)) return;
      // The amount field finishes the previous session on the completed click,
      // so layout changes cannot retarget a touch still in progress.
      if (target.matches("input[data-amount-input]:not(:disabled)")) return;
      if (target.closest("[data-page-back]")) return;
      const dialog = target.closest("dialog");
      if (dialog && dialog !== s.element.closest("dialog")) return;
      let ok = false;
      flushSync(() => {
        ok = finishRef.current(target);
      });
      if (!ok) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isIOS()) s.element.focus();
      }
    };
    const submit = (event: SubmitEvent) => {
      let ok = false;
      flushSync(() => {
        ok = finishRef.current();
      });
      if (!ok) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", resetPointer, true);
    document.addEventListener("keydown", resetPointer, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("submit", submit, true);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", resetPointer, true);
      document.removeEventListener("keydown", resetPointer, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!session) return;
    const element = panel.current!;
    // A popover joins the top layer, including when the field is in a modal dialog.
    element.showPopover();
    const html = document.documentElement;
    const dialog = session.element.closest("dialog");
    session.element.setAttribute("data-calculator-active", "");
    html.classList.add("amount-keyboard-open");
    dialog?.classList.add("amount-keyboard-dialog");
    const measure = () => {
      html.style.setProperty(
        "--amount-keyboard-height",
        `${element.getBoundingClientRect().height}px`,
      );
      session.element.scrollIntoView({ block: "nearest" });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      session.element.removeAttribute("data-calculator-active");
      if (element.matches(":popover-open")) element.hidePopover();
      html.classList.remove("amount-keyboard-open");
      html.style.removeProperty("--amount-keyboard-height");
      dialog?.classList.remove("amount-keyboard-dialog");
    };
  }, [session?.element]);
  function key(key: string) {
    const s = current.current;
    if (!s) return;
    const options = s.options();
    s.error = "";
    if (key === "clear") {
      s.expression = "";
      s.replace = false;
    } else if (key === "back") {
      s.expression = s.expression.slice(0, -1);
      s.replace = false;
    } else if (key === "sign") {
      try {
        const value =
          calculateAmount(s.expression, options.currency, true) || "0";
        s.expression = value.startsWith("-") ? value.slice(1) : "−" + value;
        s.replace = true;
      } catch (error) {
        s.error = calculationError(error);
        refresh();
        return;
      }
    } else if (key !== "=") {
      if (s.expression.length >= 128 && !s.replace) {
        s.error = "算式过长，请先计算结果";
        refresh();
        return;
      }
      s.expression = appendAmountKey(s.expression, key, s.replace);
      s.replace = false;
    }
    s.changed = true;
    try {
      const value = calculateAmount(
        s.expression,
        options.currency,
        options.allowNegative,
      );
      options.onValueChange(value);
      if (key === "=") {
        s.expression = value.replaceAll("-", "−");
        s.replace = true;
      }
    } catch (error) {
      s.error = calculationError(error);
    }
    refresh();
  }
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const s = current.current;
      if (
        !s ||
        (event.target !== s.element &&
          !panel.current?.contains(event.target as Node))
      )
        return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const map: Record<string, string> = {
        "*": "×",
        "/": "÷",
        "-": "−",
        Backspace: "back",
        Delete: "clear",
        "=": "=",
      };
      if (/^[0-9.+]$/.test(event.key) || map[event.key]) {
        event.preventDefault();
        keyRef.current(map[event.key] || event.key);
      } else if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (finishRef.current()) s.element.blur();
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, []);
  const options = session?.options();
  const title =
    session?.element.getAttribute("aria-label") ||
    session?.element.closest("label")?.querySelector(".field-label")
      ?.textContent ||
    "金额";
  const hasExpression =
    !!session &&
    (/[+×÷]|.−/.test(session.expression) ||
      ["−", "."].includes(session.expression));
  const keys = [
    "undo",
    "clear",
    "back",
    "÷",
    "7",
    "8",
    "9",
    "×",
    "4",
    "5",
    "6",
    "−",
    "1",
    "2",
    "3",
    "+",
    options?.allowNegative ? "sign" : "00",
    "0",
    ".",
    "=",
  ];
  const keyLabels: Record<string, string> = {
    clear: "清空",
    undo: "撤销本次输入",
    back: "退格",
    sign: "切换正负号",
    "00": "输入两个零",
    "÷": "除",
    "×": "乘",
    "−": "减",
    "+": "加",
    "=": "等于",
  };
  return (
    <Context.Provider value={keyboard}>
      {children}
      {session &&
        options &&
        createPortal(
          <div
            ref={panel}
            popover="manual"
            className="amount-keyboard"
            role="region"
            aria-label="金额计算键盘"
            aria-description={`${title} · ${options.currency}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.preventDefault()}
          >
            {(hasExpression || session.error) && (
              <div className="amount-keyboard-expression" aria-live="polite">
                {session.error ? (
                  <span className="amount-keyboard-error" role="alert">
                    {session.error}
                  </span>
                ) : (
                  session.expression.replace(/[+−×÷]/g, " $& ")
                )}
              </div>
            )}
            <div className="amount-keyboard-keys">
              {keys.map((k) => (
                <button
                  type="button"
                  key={k}
                  data-calculator-key={k}
                  className={
                    /[+−×÷=]/.test(k)
                      ? "operator"
                      : ["clear", "undo", "back"].includes(k)
                        ? "utility"
                        : ""
                  }
                  aria-label={keyLabels[k] || k}
                  title={keyLabels[k] || k}
                  onClick={() => {
                    if (k === "undo") {
                      session.restore();
                      close();
                      session.element.blur();
                    } else if (k === "00") {
                      key("0");
                      key("0");
                    } else key(k);
                  }}
                >
                  {k === "clear" ? (
                    "C"
                  ) : k === "undo" ? (
                    <Icon name="Undo2" size={22} />
                  ) : k === "back" ? (
                    <Icon name="Delete" size={24} />
                  ) : k === "sign" ? (
                    "±"
                  ) : (
                    k
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="amount-keyboard-done"
              onClick={() => {
                let ok = false;
                flushSync(() => {
                  ok = finish(null, !!options.onNext);
                });
                if (ok) {
                  session.element.blur();
                  options.onNext?.();
                }
              }}
            >
              {options.nextLabel || "完成"}
            </button>
          </div>,
          session.element.closest("dialog") || document.body,
        )}
    </Context.Provider>
  );
}

export function AmountInput({ ref, ...props }: Props) {
  const keyboard = useContext(Context);
  const element = useRef<HTMLInputElement | null>(null);
  const pointerFocusing = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const {
    currency,
    allowNegative,
    onValueChange,
    onBeginEdit,
    onCommit,
    onNext,
    nextLabel,
    autoFocus,
    ...inputProps
  } = props;
  useEffect(() => {
    const input = element.current!;
    return () => keyboard.cancel(input);
  }, [keyboard, currency, props.disabled]);
  useLayoutEffect(() => {
    if (element.current) keyboard.sync(element.current);
  }, [
    keyboard,
    props.value,
    props.nextLabel,
    props.allowNegative,
    props.currency,
  ]);
  const open = () => {
    if (element.current && !props.disabled)
      keyboard.open({
        element: element.current,
        options: () => latest.current,
      });
  };
  useEffect(() => {
    if (!autoFocus) return;
    // Modal dialogs enter the top layer in their parent effect. Open afterwards,
    // so showModal() cannot dismiss a popover opened by native autofocus.
    const frame = requestAnimationFrame(() => {
      activateAmountInput(element.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  return (
    <input
      {...inputProps}
      ref={(node) => {
        element.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      type="text"
      readOnly
      inputMode="none"
      autoComplete="off"
      data-amount-input=""
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        // Open on the completed click. Resizing during touch-down can retarget
        // the delayed click onto a calculator key at the same screen position.
        pointerFocusing.current = true;
        event.preventDefault();
      }}
      onPointerCancel={(event) => {
        pointerFocusing.current = false;
        props.onPointerCancel?.(event);
      }}
      onFocus={(event) => {
        if (!pointerFocusing.current) open();
        props.onFocus?.(event);
      }}
      onClick={(event) => {
        pointerFocusing.current = false;
        if (isIOS()) {
          event.preventDefault();
          if (event.detail > 0) event.currentTarget.blur();
        } else event.currentTarget.focus({ preventScroll: true });
        open();
        props.onClick?.(event);
      }}
      onContextMenu={(event) => {
        if (isIOS()) event.preventDefault();
        props.onContextMenu?.(event);
      }}
      onPaste={(event) => {
        event.preventDefault();
        // Pasted amounts go through the same exact parser as the keypad.
        keyboard.paste(
          { element: event.currentTarget, options: () => latest.current },
          event.clipboardData.getData("text"),
        );
      }}
    />
  );
}
