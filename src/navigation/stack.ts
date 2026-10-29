import type { Route } from "../ui/context.tsx";
export const tabs = [
  "accounts",
  "transactions",
  "reports",
  "settings",
] as const;
export type Tab = (typeof tabs)[number];
export interface Frame {
  key: number;
  route: Route;
}
export interface Branch {
  past: Frame[];
  future: Frame[];
}
export interface Navigation {
  tab: Tab;
  stacks: Record<Tab, Branch>;
  serial: number;
}
export function initialNavigation(): Navigation {
  return {
    tab: "accounts",
    serial: 4,
    stacks: Object.fromEntries(
      tabs.map((page, i) => [
        page,
        { past: [{ key: i, route: { page } }], future: [] },
      ]),
    ) as unknown as Record<Tab, Branch>,
  };
}
export const currentFrame = (n: Navigation) => n.stacks[n.tab].past.at(-1)!;
export function rootRoute(r: Route): boolean {
  return (
    tabs.includes(r.page as Tab) &&
    !r.report &&
    !r.from &&
    !r.to &&
    !r.accountIds &&
    !r.reportKind
  );
}
export type NavigationAction =
  { type: "open"; route: Route } | { type: "back" | "forward" };
export function navigate(n: Navigation, a: NavigationAction): Navigation {
  const b = n.stacks[n.tab];
  if (a.type === "open") {
    if (rootRoute(a.route)) {
      const tab = a.route.page as Tab;
      if (tab !== n.tab) return { ...n, tab };
      if (b.past.length === 1) return n;
      return {
        ...n,
        stacks: {
          ...n.stacks,
          [tab]: {
            past: b.past.slice(0, 1),
            future: [...b.past.slice(1), ...b.future],
          },
        },
      };
    }
    if (JSON.stringify(currentFrame(n).route) === JSON.stringify(a.route))
      return n;
    return {
      ...n,
      serial: n.serial + 1,
      stacks: {
        ...n.stacks,
        [n.tab]: {
          past: [...b.past, { key: n.serial, route: a.route }],
          future: [],
        },
      },
    };
  }
  if (a.type === "back") {
    if (b.past.length <= 1) return n;
    return {
      ...n,
      stacks: {
        ...n.stacks,
        [n.tab]: {
          past: b.past.slice(0, -1),
          future: [b.past.at(-1)!, ...b.future],
        },
      },
    };
  }
  if (!b.future.length) return n;
  // A revisited editor always mounts fresh; discarded unsaved fields never become a draft.
  return {
    ...n,
    stacks: {
      ...n.stacks,
      [n.tab]: { past: [...b.past, b.future[0]], future: b.future.slice(1) },
    },
  };
}
