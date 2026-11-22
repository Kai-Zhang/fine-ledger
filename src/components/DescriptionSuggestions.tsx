import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { Entry } from "../domain/types.ts";

type AccessoryPosition = { top: number; left: number; width: number };

export function DescriptionSuggestions({
  items,
  mode,
  onPick,
  preview = false,
}: {
  items: Entry[];
  mode: "recent" | "editing" | "hidden";
  onPick: (e: Entry) => void;
  preview?: boolean;
}) {
  const baseline = useRef(typeof window === "undefined" ? 0 : innerHeight);
  const [accessory, setAccessory] = useState<AccessoryPosition | null>(null);
  const [pressed, setPressed] = useState<{
    items: Entry[];
    position: AccessoryPosition | null;
  } | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearPress = () => {
    clearTimeout(releaseTimer.current);
    setPressed(null);
  };
  useEffect(() => () => clearTimeout(releaseTimer.current), []);
  useEffect(() => {
    if (preview) return;
    const vv = window.visualViewport;
    const update = () => {
      const height = vv?.height || innerHeight,
        layout = Math.max(
          innerHeight,
          document.documentElement.clientHeight,
          baseline.current,
        );
      if (mode !== "editing") baseline.current = Math.max(innerHeight, height);
      setAccessory(
        mode === "editing" && layout - height > 110
          ? {
              top: (vv?.offsetTop || 0) + height - 46,
              left: vv?.offsetLeft || 0,
              width: vv?.width || innerWidth,
            }
          : null,
      );
    };
    const orientation = () => {
      baseline.current = innerHeight;
      update();
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", orientation);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", orientation);
    };
  }, [mode, preview]);
  const visible = pressed ?? {
    items: mode === "hidden" ? [] : items,
    position: mode === "editing" ? accessory : null,
  };
  if (preview || !visible.items.length) return null;
  const content = visible.items.map((e) => (
    <button
      key={e.id}
      type="button"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        if (event.pointerType === "touch") {
          // iOS can blur the input and move the viewport before delivering click.
          // Keep this exact set of buttons in place until the tap is resolved.
          clearTimeout(releaseTimer.current);
          setPressed(visible);
        }
      }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerUp={(event) => {
        if (event.pointerType === "touch") {
          clearTimeout(releaseTimer.current);
          releaseTimer.current = setTimeout(clearPress, 400);
        }
      }}
      onPointerCancel={clearPress}
      onClick={() => {
        clearPress();
        onPick(e);
      }}
    >
      {e.description}
    </button>
  ));
  if (visible.position)
    return createPortal(
      <div
        className="description-accessory"
        role="region"
        aria-label="描述候选"
        data-no-back
        style={visible.position}
      >
        {content}
      </div>,
      document.body,
    );
  return (
    <div
      className="suggestions-inline"
      role="region"
      aria-label="描述候选"
      data-no-back
    >
      {content}
    </div>
  );
}
