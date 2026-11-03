export type StartPage = "choose" | "create" | "connect" | "file";
type StartFrame = { key: number; page: StartPage };
export type StartNavigation = {
  tab: "start";
  serial: number;
  stacks: { start: { past: StartFrame[]; future: StartFrame[] } };
};
export function initialStartNavigation(): StartNavigation {
  return {
    tab: "start",
    serial: 1,
    stacks: { start: { past: [{ key: 0, page: "choose" }], future: [] } },
  };
}
export function startNavigate(
  n: StartNavigation,
  action: { type: "open"; page: StartPage } | { type: "back" | "forward" },
): StartNavigation {
  const b = n.stacks.start;
  if (action.type === "open") {
    if (b.past.at(-1)!.page === action.page) return n;
    return {
      ...n,
      serial: n.serial + 1,
      stacks: {
        start: {
          past: [...b.past, { key: n.serial, page: action.page }],
          future: [],
        },
      },
    };
  }
  if (action.type === "back") {
    if (b.past.length === 1) return n;
    return {
      ...n,
      stacks: {
        start: {
          past: b.past.slice(0, -1),
          future: [b.past.at(-1)!, ...b.future],
        },
      },
    };
  }
  if (!b.future.length) return n;
  return {
    ...n,
    stacks: {
      start: { past: [...b.past, b.future[0]], future: b.future.slice(1) },
    },
  };
}
