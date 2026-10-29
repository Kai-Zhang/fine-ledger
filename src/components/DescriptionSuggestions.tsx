import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { Entry } from "../domain/types.ts";
export function DescriptionSuggestions({
  items,
  active,
  onPick,
  preview = false,
}: {
  items: Entry[];
  active: boolean;
  onPick: (e: Entry) => void;
  preview?: boolean;
}) {
  const baseline = useRef(typeof window === "undefined" ? 0 : innerHeight);
  const [viewport, setViewport] = useState<{
    top: number;
    left: number;
    width: number;
    keyboard: boolean;
  }>({ top: 0, left: 0, width: 0, keyboard: false });
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
      if (!active) baseline.current = Math.max(innerHeight, height);
      setViewport({
        top: (vv?.offsetTop || 0) + height - 46,
        left: vv?.offsetLeft || 0,
        width: vv?.width || innerWidth,
        keyboard: active && layout - height > 110,
      });
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
  }, [active, preview]);
  if (preview || !items.length) return null;
  const content = items.map((e) => (
    <button
      key={e.id}
      type="button"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onPick(e)}
    >
      {e.description}
    </button>
  ));
  if (viewport.keyboard && active)
    return createPortal(
      <div
        className="description-accessory"
        role="region"
        aria-label="描述候选"
        data-no-back
        style={{
          top: viewport.top,
          left: viewport.left,
          width: viewport.width,
        }}
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
