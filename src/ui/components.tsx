import { useEffect, useRef, useId, useState, type ReactNode } from "react";
import { Icon } from "./icons.tsx";
import { useApp } from "./context.tsx";
import { money } from "../domain/money.ts";
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/icon.svg" width="36" height="36" alt="" draggable={false} />
    </span>
  );
}
export function Button({
  children,
  icon,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  variant?: "primary" | "soft" | "plain" | "danger";
}) {
  return (
    <button {...props} className={`button ${variant} ${className}`}>
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}
export function IconButton({
  name,
  label,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  name: string;
  label: string;
}) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={`icon-button ${props.className || ""}`}
      aria-label={label}
      title={label}
    >
      <Icon name={name} />
    </button>
  );
}
export function SettingRow({
  icon,
  label,
  detail,
  value,
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label: string;
  detail?: string;
  value?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`setting-row ${danger ? "danger-text" : ""} ${props.className || ""}`}
    >
      <Icon name={icon} />
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      {value && <small>{value}</small>}
      <Icon name="ChevronRight" size={16} />
    </button>
  );
}
export function Header({
  title,
  back,
  children,
  kicker,
}: {
  title: string;
  back?: boolean;
  children?: ReactNode;
  kicker?: string;
}) {
  const app = useApp();
  return (
    <header className={`page-header ${back ? "has-back" : ""}`}>
      {back && <IconButton name="ArrowLeft" label="返回" onClick={app.back} />}
      <div className="header-title">
        {kicker && <span className="eyebrow">{kicker}</span>}
        <h1>{title}</h1>
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}
export function Field({
  label,
  children,
  error,
  optional,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {optional && <span className="muted">选填</span>}
      </span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}
export function Empty({
  icon = "List",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Amount({
  value,
  currency,
  code = false,
  className = "",
}: {
  value: string | bigint;
  currency: string;
  code?: boolean;
  className?: string;
}) {
  return (
    <span className={`amount ${className}`}>
      {money(value, currency)}
      {code && <small>{currency}</small>}
    </span>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="error-banner" role="alert">
      <Icon name="AlertCircle" size={18} />
      {message}
    </p>
  ) : null;
}
export function Dialog({
  title,
  children,
  wide = false,
  onClose,
  dirty,
  guard = true,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  dirty?: boolean;
  guard?: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  const [changed, setChanged] = useState(false);
  const closeRef = useRef(() => {}),
    dirtyRef = useRef(false);
  dirtyRef.current = guard && (dirty ?? changed);
  closeRef.current = () =>
    guard ? app.leave(onClose, dirty ?? changed) : onClose();
  useEffect(
    () =>
      app.registerLayer(
        () => closeRef.current(),
        () => dirtyRef.current,
      ),
    [app.registerLayer],
  );
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-labelledby={id}
      onChangeCapture={(e) => {
        if ((e.target as HTMLElement).closest("form")) setChanged(true);
      }}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <IconButton name="X" label="关闭" onClick={() => closeRef.current()} />
      </div>
      {children}
    </dialog>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  detail,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  detail?: string;
}) {
  return (
    <button
      type="button"
      className="toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
    >
      <span>
        {label}
        {detail && <small className="muted">{detail}</small>}
      </span>
      <span className={`switch ${checked ? "on" : ""}`}>
        <span />
      </span>
    </button>
  );
}
export function SectionTitle({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
