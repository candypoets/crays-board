import type { Member, MenuItem, Order, VenueEvent } from "@/types/domain";

/** Presentation-only data. Protocol adapters will replace this module. */
export const sampleOrders: Order[] = [
  {
    id: "1048",
    guest: "Maya R.",
    state: "pending",
    createdAt: "2 min",
    total: "₿ 18,400",
    payment: "paid",
    items: [
      { name: "Miso aubergine", quantity: 2 },
      { name: "Ginger spritz", quantity: 1, note: "No ice" },
    ],
  },
  {
    id: "1047",
    guest: "Jonas", state: "pending", createdAt: "5 min", total: "₿ 8,200", payment: "paid",
    items: [{ name: "House noodles", quantity: 1 }],
  },
  {
    id: "1046",
    guest: "Alba S.", state: "accepted", createdAt: "8 min", total: "₿ 21,600", payment: "paid",
    items: [{ name: "Supper set", quantity: 2 }, { name: "Citrus soda", quantity: 2 }],
  },
  {
    id: "1045",
    guest: "Table 7", state: "processing", createdAt: "12 min", total: "₿ 12,100", payment: "paid",
    items: [{ name: "Chilli dumplings", quantity: 2 }, { name: "Mineral water", quantity: 1 }],
  },
  {
    id: "1044",
    guest: "Noah", state: "processing", createdAt: "16 min", total: "₿ 7,900", payment: "paid",
    items: [{ name: "House noodles", quantity: 1, note: "Gluten free" }],
  },
  {
    id: "1043",
    guest: "Lina P.", state: "ready", createdAt: "18 min", total: "₿ 9,500", payment: "paid",
    items: [{ name: "Miso aubergine", quantity: 1 }, { name: "Ginger spritz", quantity: 1 }],
  },
];

export const sampleMenu: MenuItem[] = [
  { id: "m1", name: "Chilli dumplings", description: "Black vinegar, sesame, spring onion", price: "₿ 4,800", section: "Kitchen", available: true, dietary: ["V"] },
  { id: "m2", name: "Miso aubergine", description: "Barley miso, crispy shallot", price: "₿ 6,200", section: "Kitchen", available: true, dietary: ["VG"] },
  { id: "m3", name: "House noodles", description: "Broth, seasonal greens, chilli oil", price: "₿ 7,900", section: "Kitchen", available: true },
  { id: "m4", name: "Supper set", description: "Three plates chosen by the kitchen", price: "₿ 10,800", section: "Kitchen", available: false },
  { id: "m5", name: "Ginger spritz", description: "Fresh ginger, citrus, soda", price: "₿ 2,100", section: "Drinks", available: true },
  { id: "m6", name: "Citrus soda", description: "Bergamot, lemon, sparkling water", price: "₿ 1,800", section: "Drinks", available: true },
];

export const sampleEvents: VenueEvent[] = [
  { id: "e1", title: "Soft opening supper", date: "Tonight", time: "19:30", status: "sold-out", attendance: "48 / 48" },
  { id: "e2", title: "Sunday listening room", date: "09 Aug", time: "16:00", status: "published", attendance: "31 going" },
  { id: "e3", title: "Community table: fermentation", date: "14 Aug", time: "18:30", status: "published", attendance: "18 going" },
  { id: "e4", title: "Late summer menu preview", date: "22 Aug", time: "20:00", status: "draft", attendance: "Not published" },
];

export const sampleMembers: Member[] = [
  { id: "p1", name: "Mina Alvarez", role: "Owner", initials: "MA", status: "on-shift" },
  { id: "p2", name: "Theo Mertens", role: "Manager", initials: "TM", status: "on-shift" },
  { id: "p3", name: "Amal Hassan", role: "Kitchen", initials: "AH", status: "on-shift" },
  { id: "p4", name: "Mara Klein", role: "Host", initials: "MK", status: "offline" },
  { id: "p5", name: "Sam Dupont", role: "Events", initials: "SD", status: "offline" },
];
