/**
 * THESIS: A calm service desk behind a lively Crays venue.
 * OWNED WORLD: Blush paper meets an after-dark burgundy rail; Crays pink and
 * coral become precise signals for action, urgency, and hand-off.
 * STORY: Staff enter through venue context, read the live service strip, then
 * move directly into the order, menu, event, or community task that needs them.
 * FIRST VIEWPORT: Venue, open status, decisions waiting, kitchen movement,
 * tonight's room, and the next operational actions are visible without digging.
 * FORM: A persistent venue rail on tablets, bottom navigation on phones, flat
 * working lanes, compact status pills, and 48dp touch controls throughout.
 */
import { useState } from "react";
import { useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BoardShell } from "@/components/BoardShell";
import { sampleEvents, sampleMembers, sampleMenu, sampleOrders } from "@/data/sample";
import { colors } from "@/theme/colors";
import type { Area, MenuItem, Order, VenueEvent } from "@/types/domain";
import { CreateVenueScreen } from "@/screens/CreateVenueScreen";
import { EventsScreen } from "@/screens/EventsScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { MenuScreen } from "@/screens/MenuScreen";
import { OrdersScreen } from "@/screens/OrdersScreen";
import { InvitesScreen, MoreScreen, PeopleScreen, SettingsScreen } from "@/screens/CommunityScreens";

export function BoardApp() {
  const { width } = useWindowDimensions();
  const [area, setArea] = useState<Area>("home");
  const [orders, setOrders] = useState<Order[]>(sampleOrders);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(sampleMenu);
  const [events, setEvents] = useState<VenueEvent[]>(sampleEvents);

  if (area === "create-venue") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={["top", "right", "bottom", "left"]}>
        <CreateVenueScreen width={width} onCancel={() => setArea("home")} onCreated={() => setArea("home")} />
      </SafeAreaView>
    );
  }

  const renderArea = () => {
    switch (area) {
      case "orders":
        return <OrdersScreen width={width} orders={orders} onOrdersChange={setOrders} />;
      case "menu":
        return <MenuScreen width={width} items={menuItems} onItemsChange={setMenuItems} />;
      case "events":
        return <EventsScreen width={width} events={events} onEventsChange={setEvents} />;
      case "people":
        return <PeopleScreen width={width} members={sampleMembers} />;
      case "invites":
        return <InvitesScreen width={width} />;
      case "settings":
        return <SettingsScreen width={width} />;
      case "more":
        return <MoreScreen onNavigate={setArea} />;
      case "home":
      default:
        return <HomeScreen width={width} orders={orders} onNavigate={setArea} />;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.night }} edges={["top", "right", "bottom", "left"]}>
      <BoardShell area={area} width={width} onSelect={setArea}>
        {renderArea()}
      </BoardShell>
    </SafeAreaView>
  );
}
