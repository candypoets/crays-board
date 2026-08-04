import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Button, Field, Panel, ScreenTitle } from "@/components/ui";
import { colors } from "@/theme/colors";
import type { MenuItem } from "@/types/domain";

export function MenuScreen({ width, items, onItemsChange }: { width: number; items: MenuItem[]; onItemsChange: (items: MenuItem[]) => void }) {
  const phone = width < 600;
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [filter, setFilter] = useState("All");
  const sections = ["All", ...Array.from(new Set(items.map((item) => item.section)))];
  const visible = filter === "All" ? items : items.filter((item) => item.section === filter);

  const toggle = (item: MenuItem) => onItemsChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, available: !candidate.available } : candidate));

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle
        title="Menu"
        description="Control what guests can order right now. Availability updates should be immediate."
        action={<Button label={phone ? "Add" : "Add item"} icon="plus" onPress={() => setEditing({ id: "new", name: "", description: "", price: "", section: "Kitchen", available: true })} />}
      />

      <View style={[styles.healthStrip, phone && styles.healthStripPhone]}>
        <View style={styles.healthCopy}>
          <View style={styles.healthIcon}><MaterialCommunityIcons name="check-decagram-outline" size={22} color={colors.success} /></View>
          <View>
            <Text style={styles.healthTitle}>{items.filter((item) => item.available).length} items available</Text>
            <Text style={styles.healthDescription}>The guest menu is live and in sync.</Text>
          </View>
        </View>
        <Badge label={`${items.filter((item) => !item.available).length} unavailable`} tone="warning" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {sections.map((section) => (
          <Pressable key={section} onPress={() => setFilter(section)} style={[styles.filter, filter === section && styles.filterActive]}>
            <Text style={[styles.filterText, filter === section && styles.filterTextActive]}>{section}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Panel padded={false}>
        <View style={[styles.tableHead, phone && styles.tableHeadPhone]}>
          <Text style={[styles.tableLabel, styles.itemColumn]}>Item</Text>
          {!phone ? <Text style={[styles.tableLabel, styles.priceColumn]}>Price</Text> : null}
          <Text style={[styles.tableLabel, styles.availabilityColumn]}>Available</Text>
          <View style={styles.actionColumn} />
        </View>
        {visible.map((item) => (
          <View key={item.id} style={[styles.itemRow, phone && styles.itemRowPhone]}>
            <View style={styles.itemColumn}>
              <View style={styles.nameLine}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.dietary?.map((tag) => <Badge key={tag} label={tag} tone="success" />)}
              </View>
              <Text style={styles.itemDescription}>{item.description}</Text>
              {phone ? <Text style={styles.mobilePrice}>{item.price}</Text> : null}
            </View>
            {!phone ? <Text style={[styles.itemPrice, styles.priceColumn]}>{item.price}</Text> : null}
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: item.available }} onPress={() => toggle(item)} style={[styles.availability, styles.availabilityColumn]}>
              <View style={[styles.toggleTrack, item.available && styles.toggleTrackOn]}><View style={[styles.toggleThumb, item.available && styles.toggleThumbOn]} /></View>
              {!phone ? <Text style={[styles.availabilityText, !item.available && styles.unavailableText]}>{item.available ? "On" : "Off"}</Text> : null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={() => setEditing(item)} style={[styles.editButton, styles.actionColumn]}>
              <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.inkMuted} />
            </Pressable>
          </View>
        ))}
      </Panel>

      {editing ? (
        <Panel style={styles.editor}>
          <View style={styles.editorHeader}>
            <View>
              <Text style={styles.editorTitle}>{editing.id === "new" ? "Add menu item" : `Edit ${editing.name}`}</Text>
              <Text style={styles.editorDescription}>Changes become visible to guests after you save.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={() => setEditing(null)} style={styles.closeButton}><MaterialCommunityIcons name="close" size={22} color={colors.ink} /></Pressable>
          </View>
          <View style={[styles.formGrid, phone && styles.formGridPhone]}>
            <Field label="Name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} placeholder="e.g. Seasonal plate" />
            <Field label="Price in sats" value={editing.price} onChangeText={(price) => setEditing({ ...editing, price })} placeholder="₿ 6,400" keyboardType="numeric" />
            <View style={styles.fullField}><Field label="Description" value={editing.description} onChangeText={(description) => setEditing({ ...editing, description })} placeholder="What guests should know" multiline /></View>
          </View>
          <View style={styles.editorActions}><Button label="Cancel" tone="quiet" onPress={() => setEditing(null)} /><Button label="Save item" disabled={!editing.name || !editing.price} onPress={() => {
            if (editing.id === "new") onItemsChange([...items, { ...editing, id: `m${Date.now()}` }]);
            else onItemsChange(items.map((item) => item.id === editing.id ? editing : item));
            setEditing(null);
          }} /></View>
        </Panel>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 30, paddingBottom: 54, maxWidth: 1320, width: "100%", alignSelf: "center" },
  scrollPhone: { padding: 18, paddingBottom: 36 },
  healthStrip: { minHeight: 78, paddingHorizontal: 18, marginBottom: 20, borderRadius: 16, backgroundColor: colors.successSoft, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  healthStripPhone: { alignItems: "flex-start", paddingVertical: 15 },
  healthCopy: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  healthIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  healthTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  healthDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  filters: { gap: 8, paddingBottom: 16 },
  filter: { minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.white, justifyContent: "center", paddingHorizontal: 16 },
  filterActive: { backgroundColor: colors.night, borderColor: colors.night },
  filterText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: colors.white },
  tableHead: { minHeight: 45, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.surfaceWarm, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeadPhone: { paddingHorizontal: 14 },
  tableLabel: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  itemRow: { minHeight: 88, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemRowPhone: { minHeight: 105, paddingHorizontal: 14, gap: 10 },
  itemColumn: { flex: 1, minWidth: 0 },
  priceColumn: { width: 105 },
  availabilityColumn: { width: 110 },
  actionColumn: { width: 44 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  itemName: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  itemDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  itemPrice: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  mobilePrice: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 7 },
  availability: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  toggleTrack: { width: 42, height: 25, borderRadius: 13, backgroundColor: colors.borderStrong, padding: 3 },
  toggleTrackOn: { backgroundColor: colors.success },
  toggleThumb: { width: 19, height: 19, borderRadius: 10, backgroundColor: colors.white },
  toggleThumbOn: { marginLeft: 17 },
  availabilityText: { color: colors.success, fontSize: 12, fontWeight: "800" },
  unavailableText: { color: colors.inkMuted },
  editButton: { height: 44, alignItems: "center", justifyContent: "center" },
  editor: { marginTop: 20 },
  editorHeader: { flexDirection: "row", justifyContent: "space-between", gap: 15, marginBottom: 22 },
  editorTitle: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  editorDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  closeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  formGridPhone: { flexDirection: "column" },
  fullField: { width: "100%" },
  editorActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 22 },
});
