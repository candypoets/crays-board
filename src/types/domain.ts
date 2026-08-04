import type { ComponentProps } from "react";
import type { MaterialCommunityIcons } from "@expo/vector-icons";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type Area =
  | "home"
  | "orders"
  | "menu"
  | "events"
  | "people"
  | "invites"
  | "settings"
  | "more"
  | "create-venue";

export type OrderState =
  | "pending"
  | "accepted"
  | "processing"
  | "ready"
  | "fulfilled"
  | "cancelled";

export interface OrderItem {
  name: string;
  quantity: number;
  note?: string;
}

export interface Order {
  id: string;
  guest: string;
  state: OrderState;
  createdAt: string;
  total: string;
  payment: "paid" | "unpaid";
  items: OrderItem[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: string;
  section: string;
  available: boolean;
  dietary?: string[];
}

export interface VenueEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  status: "draft" | "published" | "sold-out";
  attendance: string;
}

export interface Member {
  id: string;
  name: string;
  role: string;
  initials: string;
  status: "on-shift" | "offline" | "invited";
}
