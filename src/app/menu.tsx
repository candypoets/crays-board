import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Badge, Button, EmptyState, Field, Panel, ScreenTitle, ToggleRow } from "@/components/ui";
import { buildMenuDefinitionUpdate, draftFromItem, validateMenuDraft, type MenuDraft } from "@/menu/protocol";
import { filterMenu, UNSECTIONED, type MenuAvailability, type MenuItem, type MenuSection } from "@/menu/fold";
import { useMenu } from "@/menu/useMenu";
import { publishEvent } from "@/nostr/publish";
import { AppShell } from "@/shell/AppShell";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** Owner/admin persona used by the QA seed; permission filtering lands with sign-in. */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

type MutationState =
  | { phase: "publishing"; draft: MenuDraft }
  | { phase: "confirmed"; draft: MenuDraft }
  | { phase: "error"; draft: MenuDraft; message: string };

const AVAILABILITY_LABEL: Record<MenuAvailability, string> = {
  available: "Available",
  unavailable: "Unavailable",
  archived: "Archived",
};

const AVAILABILITY_TONE: Record<MenuAvailability, "success" | "warning" | "neutral"> = {
  available: "success",
  unavailable: "warning",
  archived: "neutral",
};

/**
 * A confirmed write whose relay echo has not reached the projection yet keeps
 * showing its intended values; once the subscription catches up the
 * projection equals the draft and the override becomes a no-op.
 */
function displayItem(item: MenuItem, mutation?: MutationState): MenuItem {
  if (mutation?.phase !== "confirmed") return item;
  const draft = mutation.draft;
  if (item.name === draft.name.trim() && item.availability === draft.availability) return item;
  return {
    ...item,
    name: draft.name.trim(),
    availability: draft.availability,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    price: draft.price.trim(),
    currency: draft.currency.trim(),
    ...(draft.section.trim() ? { section: draft.section.trim() } : {}),
  };
}

function chipTestId(name: string): string {
  return `menu-chip-${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
}

function MenuItemRow({
  item,
  editable,
  mutation,
  onToggleAvailability,
  onEdit,
}: {
  item: MenuItem;
  editable: boolean;
  mutation?: MutationState;
  onToggleAvailability: (item: MenuItem) => void;
  onEdit: (item: MenuItem) => void;
}) {
  const publishing = mutation?.phase === "publishing";
  return (
    <Panel testID={`menu-item-${item.d}`} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.itemName} numberOfLines={2}>
          {item.name}
        </Text>
        <Badge label={AVAILABILITY_LABEL[item.availability]} tone={AVAILABILITY_TONE[item.availability]} />
      </View>
      {item.description ? (
        <Text style={styles.itemDescription} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {item.price ? `${item.price} ${item.currency ?? ""}`.trim() : "No price"}
        </Text>
        <Text style={styles.metaText}>{item.section ?? UNSECTIONED}</Text>
      </View>
      {editable ? (
        <View style={styles.actionRow}>
          {item.availability !== "archived" ? (
            <Button
              testID={`menu-availability-toggle-${item.d}`}
              compact
              tone="secondary"
              label={
                publishing
                  ? "Saving…"
                  : mutation?.phase === "error"
                    ? "Retry"
                    : item.availability === "available"
                      ? "Mark unavailable"
                      : "Mark available"
              }
              onPress={() => onToggleAvailability(item)}
              disabled={publishing}
            />
          ) : null}
          <Button
            testID={`menu-edit-${item.d}`}
            compact
            tone="quiet"
            label="Edit"
            onPress={() => onEdit(item)}
            disabled={publishing}
          />
          {mutation?.phase === "error" ? <Text style={styles.errorText}>{mutation.message}</Text> : null}
        </View>
      ) : (
        <Text testID={`menu-foreign-note-${item.d}`} style={styles.foreignNote}>
          Published by another trusted key — visible here, but only that key can edit it.
        </Text>
      )}
    </Panel>
  );
}

function MenuEditor({
  item,
  mutation,
  onSave,
  onSetAvailability,
  onCancel,
}: {
  item: MenuItem;
  mutation?: MutationState;
  onSave: (draft: MenuDraft) => void;
  onSetAvailability: (availability: MenuAvailability) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<MenuDraft>(() => draftFromItem(item));
  const [attemptedSave, setAttemptedSave] = useState(false);
  const errors = validateMenuDraft(draft);
  const publishing = mutation?.phase === "publishing";
  const archived = item.availability === "archived";
  const update = (patch: Partial<MenuDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = () => {
    setAttemptedSave(true);
    if (Object.keys(errors).length > 0) return; // invalid drafts never publish (MENU-03)
    onSave(draft);
  };

  return (
    <View testID="menu-editor" style={styles.editor}>
      <ScrollView style={styles.editorScroll} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.editorTitle}>Edit {item.name}</Text>
        <Field
          label="Name"
          testID="menu-field-name"
          value={draft.name}
          onChangeText={(name) => update({ name })}
          hint={attemptedSave ? errors.name : undefined}
        />
        <Field
          label="Description"
          testID="menu-field-description"
          value={draft.description}
          onChangeText={(description) => update({ description })}
          multiline
        />
        <View style={styles.editorRow}>
          <View style={styles.editorCell}>
            <Field
              label="Price"
              testID="menu-field-price"
              value={draft.price}
              onChangeText={(price) => update({ price })}
              keyboardType="decimal-pad"
              hint={attemptedSave ? errors.price : undefined}
            />
          </View>
          <View style={styles.editorCell}>
            <Field
              label="Currency"
              testID="menu-field-currency"
              value={draft.currency}
              onChangeText={(currency) => update({ currency: currency.toUpperCase() })}
              autoCapitalize="characters"
              maxLength={3}
              hint={attemptedSave ? errors.currency : undefined}
            />
          </View>
        </View>
        <Field
          label="Section"
          testID="menu-field-section"
          value={draft.section}
          onChangeText={(section) => update({ section })}
          hint="Hospitality sections such as Mains or Drinks."
        />
        {!archived ? (
          <ToggleRow
            title="Available for ordering"
            description="Unavailable items stay on the menu but guests cannot order them."
            value={draft.availability === "available"}
            onValueChange={(value) => update({ availability: value ? "available" : "unavailable" })}
          />
        ) : null}
        <View style={styles.archiveRow}>
          {archived ? (
            <Button
              testID="menu-restore-button"
              tone="secondary"
              label="Restore item"
              onPress={() => onSetAvailability("available")}
              disabled={publishing}
            />
          ) : (
            <Button
              testID="menu-archive-button"
              tone="quiet"
              label="Archive item"
              onPress={() => onSetAvailability("archived")}
              disabled={publishing}
            />
          )}
        </View>
        {mutation?.phase === "error" ? <Text style={styles.errorText}>{mutation.message}</Text> : null}
        {/* Actions live inside the scroll content: as a pinned sibling after
            the ScrollView they intermittently failed to mount on cold
            sessions (empty footer), which the device QA gate caught. */}
        <View style={styles.editorActions}>
          <Button testID="menu-cancel-button" tone="secondary" label="Cancel" onPress={onCancel} disabled={publishing} />
          <Button
            testID="menu-save-button"
            label={publishing ? "Saving…" : mutation?.phase === "error" ? "Retry save" : "Save item"}
            onPress={save}
            disabled={publishing}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function MenuSubscription({ onRetry }: { onRetry: () => void }) {
  const { venue } = useVenue();
  const breakpoint = useBreakpoint();
  const { status, sections, error } = useMenu();
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [mutations, setMutations] = useState<Record<string, MutationState>>({});
  // MENU-06 / §6.8-style guard: a double-tap can deliver both presses before
  // React commits the "publishing" state, so the ref is updated synchronously
  // in the same handler — at most one publish per deliberate action.
  const inFlight = useRef(new Set<string>());

  const activePubkey = venue?.pubkey.toLowerCase() ?? "";

  const itemsByAddress = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const section of sections) for (const item of section.items) map.set(item.address, item);
    return map;
  }, [sections]);

  const publishDraft = (item: MenuItem, draft: MenuDraft) => {
    if (!venue || inFlight.current.has(item.address)) return;
    // MENU-05: only the original publishing key may edit; the UI hides the
    // controls AND the publish path refuses foreign items.
    if (item.author !== activePubkey) return;
    inFlight.current.add(item.address);
    setMutations((current) => ({ ...current, [item.address]: { phase: "publishing", draft } }));
    void (async () => {
      // §3.1 update rule: every mutation republishes the same addressable d;
      // success is confirmed only after an affirmative relay acknowledgement.
      const template = buildMenuDefinitionUpdate(item, draft);
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "menu_definition");
      if (__DEV__) {
        console.log(
          `[crays-board-menu-definition]${JSON.stringify({
            id: signed.id,
            d: item.d,
            availability: draft.availability,
            name: draft.name.trim(),
          })}`,
        );
      }
      setMutations((current) => ({ ...current, [item.address]: { phase: "confirmed", draft } }));
      setEditingAddress((current) => (current === item.address ? null : current));
    })()
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setMutations((current) => ({ ...current, [item.address]: { phase: "error", draft, message } }));
      })
      .finally(() => {
        inFlight.current.delete(item.address);
      });
  };

  const toggleAvailability = (item: MenuItem) => {
    const next: MenuAvailability = item.availability === "available" ? "unavailable" : "available";
    publishDraft(item, { ...draftFromItem(item), availability: next });
  };

  const visible = filterMenu(sections, { search, section: sectionFilter });
  const editingItem = editingAddress ? itemsByAddress.get(editingAddress) : undefined;
  const editingDisplayed = editingItem ? displayItem(editingItem, mutations[editingItem.address]) : undefined;

  if (status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lan-disconnect"
          title="Cannot reach this venue"
          description={error ?? "The venue relay or service did not answer."}
          action={<Button label="Try again" tone="secondary" onPress={onRetry} />}
        />
      </View>
    );
  }

  const list = (
    <View style={styles.listColumn}>
      <Field
        label="Search"
        testID="menu-search"
        value={search}
        onChangeText={setSearch}
        placeholder="Search the menu"
      />
      <View style={styles.chips}>
        <Pressable
          testID="menu-chip-all"
          accessibilityRole="button"
          accessibilityState={{ selected: sectionFilter === null }}
          onPress={() => setSectionFilter(null)}
          style={[styles.chip, sectionFilter === null && styles.chipActive]}
        >
          <Text style={[styles.chipLabel, sectionFilter === null && styles.chipLabelActive]}>All</Text>
        </Pressable>
        {sections.map((section) => (
          <Pressable
            key={section.name}
            testID={chipTestId(section.name)}
            accessibilityRole="button"
            accessibilityState={{ selected: sectionFilter === section.name }}
            onPress={() => setSectionFilter((current) => (current === section.name ? null : section.name))}
            style={[styles.chip, sectionFilter === section.name && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, sectionFilter === section.name && styles.chipLabelActive]}>
              {section.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        sections={visible.map((section: MenuSection) => ({ title: section.name, data: section.items }))}
        keyExtractor={(item) => item.address}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => {
          const displayed = displayItem(item, mutations[item.address]);
          return (
            <MenuItemRow
              item={displayed}
              editable={item.author === activePubkey}
              mutation={mutations[item.address]}
              onToggleAvailability={toggleAvailability}
              onEdit={(target) => setEditingAddress(target.address)}
            />
          );
        }}
        ListEmptyComponent={
          status === "loading" ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
            </View>
          ) : sections.length === 0 ? (
            <EmptyState
              icon="silverware-fork-knife"
              title="No menu items yet"
              description="Sellable food and drink definitions published to this venue will appear here."
            />
          ) : (
            <EmptyState
              icon="filter-off-outline"
              title="Nothing matches"
              description="No items match the current search and section filters."
              action={
                <Button
                  label="Clear filters"
                  tone="secondary"
                  onPress={() => {
                    setSearch("");
                    setSectionFilter(null);
                  }}
                />
              }
            />
          )
        }
      />
    </View>
  );

  // MENU-09: tablet keeps the list beside the editor (master-detail); the
  // phone editor takes the whole content area with sticky primary actions.
  if (breakpoint === "phone") {
    return editingDisplayed ? (
      <MenuEditor
        item={editingDisplayed}
        mutation={mutations[editingDisplayed.address]}
        onSave={(draft) => editingDisplayed && publishDraft(editingDisplayed, draft)}
        onSetAvailability={(availability) =>
          editingDisplayed && publishDraft(editingDisplayed, { ...draftFromItem(editingDisplayed), availability })
        }
        onCancel={() => setEditingAddress(null)}
      />
    ) : (
      list
    );
  }

  return (
    <View style={styles.masterDetail}>
      {list}
      {editingDisplayed ? (
        <View style={styles.detailColumn}>
          <MenuEditor
            item={editingDisplayed}
            mutation={mutations[editingDisplayed.address]}
            onSave={(draft) => editingDisplayed && publishDraft(editingDisplayed, draft)}
            onSetAvailability={(availability) =>
              editingDisplayed && publishDraft(editingDisplayed, { ...draftFromItem(editingDisplayed), availability })
            }
            onCancel={() => setEditingAddress(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function MenuRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);

  return (
    <AppShell active="menu" permissions={ADMIN_PERMISSIONS}>
      <View testID="menu-screen" style={styles.screen}>
        <View style={styles.container}>
          <ScreenTitle
            title="Menu"
            description={
              venue
                ? `Live from ${venue.relayUrl.replace(/^wss?:\/\//, "")} — availability updates publish immediately.`
                : "No venue selected"
            }
          />
          {restoring ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Restoring the venue…</Text>
            </View>
          ) : !venue ? (
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue before managing its menu."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          ) : (
            <MenuSubscription key={retryKey} onRetry={() => setRetryKey((key) => key + 1)} />
          )}
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: 24, width: "100%", alignSelf: "center" },
  masterDetail: { flex: 1, flexDirection: "row", gap: 20 },
  listColumn: { flex: 1, gap: 14 },
  detailColumn: { width: 380 },
  list: { flex: 1 },
  listContent: { gap: 12, paddingBottom: 32, flexGrow: 1 },
  sectionHeader: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginTop: 10 },
  card: { gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  itemName: { flex: 1, color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  itemDescription: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  metaText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 4 },
  foreignNote: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontStyle: "italic" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 2 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.pinkSoft, borderColor: colors.pink },
  chipLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  chipLabelActive: { color: colors.pinkDark },
  editor: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: "hidden" },
  editorScroll: { flex: 1 },
  editorContent: { padding: 20, gap: 16 },
  editorTitle: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  editorRow: { flexDirection: "row", gap: 14 },
  editorCell: { flex: 1 },
  archiveRow: { flexDirection: "row", gap: 12 },
  editorActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
