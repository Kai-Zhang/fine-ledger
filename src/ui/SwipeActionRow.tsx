import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.tsx";
import {
  rowActionWidth,
  rowSwipeIntent,
  rowSwipeOffset,
  rowSwipeOpen,
  rowSwipeStart,
} from "../navigation/row-swipe.ts";

export function SwipeActionRow({
  label,
  detail,
  open,
  editing = false,
  disabled,
  onOpenChange,
  onDelete,
}: {
  label: string;
  detail: string;
  open: boolean;
  editing?: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState<number | null>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    initial: number;
    offset: number;
    intent: string;
  } | null>(null);
  const dragged = useRef(false);
  useEffect(() => {
    gesture.current = null;
    setOffset(null);
  }, [editing]);
  return (
    <div
      className={`swipe-action-row ${editing ? "editing" : ""}`}
      data-no-back
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onOpenChange(false);
          e.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="swipe-delete"
        disabled={disabled || (!open && !editing)}
        aria-hidden={!open && !editing}
        aria-label={`删除备份 ${label}`}
        title={`删除备份 ${label}`}
        onClick={onDelete}
      >
        <Icon name="Trash2" size={20} />
      </button>
      <div
        className={`setting-row swipe-row-content ${editing ? "editing" : ""} ${offset !== null ? "dragging" : ""}`}
        style={{
          transform: editing
            ? undefined
            : `translateX(${offset ?? (open ? -rowActionWidth : 0)}px)`,
        }}
        onClick={() => {
          if (open && !editing) onOpenChange(false);
        }}
        onClickCapture={(e) => {
          if (dragged.current && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
        onPointerDown={(e) => {
          dragged.current = false;
          if (
            disabled ||
            editing ||
            e.button !== 0 ||
            !rowSwipeStart(e.clientX, innerWidth)
          )
            return;
          const initial = open ? -rowActionWidth : 0;
          gesture.current = {
            x: e.clientX,
            y: e.clientY,
            initial,
            offset: initial,
            intent: "pending",
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const s = gesture.current;
          if (!s) return;
          const dx = e.clientX - s.x,
            dy = e.clientY - s.y;
          if (s.intent === "pending") s.intent = rowSwipeIntent(dx, dy);
          if (s.intent === "vertical") {
            dragged.current = true;
            onOpenChange(false);
            gesture.current = null;
            setOffset(null);
            return;
          }
          if (s.intent !== "horizontal") return;
          dragged.current = true;
          e.preventDefault();
          s.offset = rowSwipeOffset(s.initial, dx);
          setOffset(s.offset);
        }}
        onPointerUp={() => {
          const s = gesture.current;
          gesture.current = null;
          if (s?.intent === "horizontal") onOpenChange(rowSwipeOpen(s.offset));
          setOffset(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setOffset(null);
        }}
      >
        <Icon name="Archive" />
        <span>
          {label}
          <small>{detail}</small>
        </span>
      </div>
    </div>
  );
}
