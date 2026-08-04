/** PRD §7 destinations and their permission requirements. */

export type Destination =
  | "home"
  | "orders"
  | "menu"
  | "events"
  | "people"
  | "invites"
  | "settings";

export const DESTINATIONS: { id: Destination; label: string; href: string }[] = [
  { id: "home", label: "Home", href: "/home" },
  { id: "orders", label: "Orders", href: "/orders" },
  { id: "menu", label: "Menu", href: "/menu" },
  { id: "events", label: "Events", href: "/events" },
  { id: "people", label: "People", href: "/people" },
  { id: "invites", label: "Invites", href: "/invites" },
  { id: "settings", label: "Settings", href: "/settings" },
];

const REQUIRED: Record<Destination, string[] | null> = {
  home: null, // any venue access
  orders: ["store", "events"],
  menu: ["store"],
  events: ["events"],
  people: ["moderation", "settings"],
  invites: ["invites"],
  settings: ["settings"],
};

/** A persona with all permissions (owner/admin) sees every destination. */
export function visibleDestinations(permissions: string[]): Destination[] {
  return DESTINATIONS.filter((d) => {
    const req = REQUIRED[d.id];
    if (!req) return true;
    return req.some((p) => permissions.includes(p));
  }).map((d) => d.id);
}

/** Phone bottom navigation: first four + More. */
export const PHONE_TABS: { id: string; label: string; href: string }[] = [
  { id: "home", label: "Home", href: "/home" },
  { id: "orders", label: "Orders", href: "/orders" },
  { id: "menu", label: "Menu", href: "/menu" },
  { id: "events", label: "Events", href: "/events" },
  { id: "more", label: "More", href: "/more" },
];
