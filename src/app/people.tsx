import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Badge, Button, EmptyState, Field, Panel, ScreenTitle } from "@/components/ui";
import { publishEvent } from "@/nostr/publish";
import {
  buildRevocation,
  buildRoleAssignment,
  buildRoleDefinition,
  parseExpiryInput,
  resolveAssigneePubkey,
} from "@/people/builders";
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  ROLE_LIMIT,
  type Permission,
  type Person,
  type PersonAward,
  type PersonStatus,
  type RevocationInput,
  type RoleSummary,
} from "@/people/fold";
import { usePeople } from "@/people/usePeople";
import { AppShell } from "@/shell/AppShell";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** The QA slice runs the admin persona, which holds every permission. */
const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

type MutationState = { phase: "publishing" } | { phase: "confirmed" } | { phase: "error"; message: string };

type Tab = "people" | "roles";

const STATUS_LABEL: Record<PersonStatus, string> = {
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
};

const STATUS_TONE: Record<PersonStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  expiring: "warning",
  expired: "neutral",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic venue-independent date rendering (e.g. "21 Aug 2026", UTC). */
function formatDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function personRoleLabel(person: Person): string {
  const activeNames = person.awards.filter((award) => award.active && award.name).map((award) => award.name as string);
  if (activeNames.length > 0) return [...new Set(activeNames)].join(", ");
  if (person.isRootAdmin) return "Owner";
  const anyName = person.awards.find((award) => award.name)?.name;
  return anyName ?? "Member";
}

/** The membership award a revocation would target: the first active one. */
function revocableMembership(person: Person): PersonAward | undefined {
  return person.awards.find((award) => award.kind === "membership" && award.active);
}

function PeopleTabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.tabs}>
      {(
        [
          { id: "people", label: "People" },
          { id: "roles", label: "Roles & access" },
        ] as const
      ).map((entry) => {
        const active = tab === entry.id;
        return (
          <Pressable
            key={entry.id}
            testID={`people-tab-${entry.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(entry.id)}
            style={[styles.tabButton, active && styles.tabButtonActive]}
          >
            <Text style={[styles.tabButtonLabel, active && styles.tabButtonLabelActive]}>{entry.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PersonRow({ person, selected, onPress }: { person: Person; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`person-row-${person.pubkey}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.personRow, selected && styles.personRowSelected]}
    >
      <View style={styles.personCopy}>
        <Text style={styles.personName} numberOfLines={1}>
          {person.displayName}
        </Text>
        <Text style={styles.personMeta} numberOfLines={1}>
          {personRoleLabel(person)}
        </Text>
      </View>
      <View style={styles.personFacts}>
        {person.nearestExpiry !== undefined && person.status !== "expired" ? (
          <Text style={styles.personMeta}>{formatDate(person.nearestExpiry)}</Text>
        ) : null}
        <Badge label={STATUS_LABEL[person.status]} tone={STATUS_TONE[person.status]} />
      </View>
    </Pressable>
  );
}

function PermissionToggle({
  permission,
  value,
  disabled,
  onChange,
}: {
  permission: Permission;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{PERMISSION_LABELS[permission]}</Text>
        <Text style={styles.toggleDescription}>{PERMISSION_DESCRIPTIONS[permission]}</Text>
      </View>
      <Switch
        testID={`permission-toggle-${permission}`}
        accessibilityLabel={PERMISSION_LABELS[permission]}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.borderStrong, true: colors.pinkSoft }}
        thumbColor={value ? colors.pink : colors.white}
      />
    </View>
  );
}

function PersonDetail({
  person,
  venueHost,
  revokeState,
  onRevoke,
  onAssignRole,
  onBack,
}: {
  person: Person;
  venueHost: string;
  revokeState?: MutationState;
  onRevoke: (award: PersonAward) => void;
  onAssignRole: (person: Person) => void;
  onBack?: () => void;
}) {
  const membership = revocableMembership(person);
  return (
    <Panel testID="person-detail" style={styles.detail}>
      {onBack ? <Button label="Back to people" tone="quiet" compact onPress={onBack} /> : null}
      <View style={styles.detailHeader}>
        <View style={styles.personCopy}>
          <Text style={styles.detailName}>{person.displayName}</Text>
          <Text style={styles.personMeta}>{person.pubkey.slice(0, 16)}…</Text>
        </View>
        <Badge label={STATUS_LABEL[person.status]} tone={STATUS_TONE[person.status]} />
      </View>
      {person.nearestExpiry !== undefined && person.status !== "expired" ? (
        <Text style={styles.personMeta}>Nearest expiry {formatDate(person.nearestExpiry)}</Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Access & permissions</Text>
        {person.permissions.length > 0 ? (
          PERMISSIONS.map((permission) => {
            const granted = person.permissions.includes(permission);
            return (
              <View key={permission} style={styles.accessRow}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>{PERMISSION_LABELS[permission]}</Text>
                </View>
                <Badge label={granted ? "Enabled" : "Disabled"} tone={granted ? "success" : "neutral"} />
              </View>
            );
          })
        ) : (
          <Text style={styles.personMeta}>
            {person.isRootAdmin ? "Root venue administrator — full access." : "No role permissions granted."}
          </Text>
        )}
      </View>

      <View style={styles.detailActions}>
        {revokeState?.phase === "confirmed" ? (
          <Text style={styles.successText}>Membership revoked</Text>
        ) : null}
        {person.isRootAdmin ? (
          <Text style={styles.noteText}>Root venue administrators cannot be revoked here.</Text>
        ) : (
          <>
            <Button
              testID="person-assign-role-button"
              label="Assign role"
              tone="secondary"
              onPress={() => onAssignRole(person)}
            />
            {membership ? (
              <Button
                testID="revoke-membership-button"
                label="Revoke membership"
                tone="danger"
                onPress={() => onRevoke(membership)}
              />
            ) : null}
          </>
        )}
      </View>
      <Text style={styles.noteText}>Venue: {venueHost}</Text>
    </Panel>
  );
}

function RevokeDialog({
  person,
  award,
  venueHost,
  state,
  onCancel,
  onConfirm,
}: {
  person: Person;
  award: PersonAward;
  venueHost: string;
  state?: MutationState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <Panel testID="revoke-dialog" style={styles.modalCard}>
          <Text style={styles.modalTitle}>Revoke membership</Text>
          <Text style={styles.modalBody}>
            This revokes {person.displayName}&apos;s {award.name ?? "membership"} at {venueHost}. Their access ends
            once the venue relay confirms the revocation.
          </Text>
          {state?.phase === "error" ? <Text style={styles.errorText}>{state.message}</Text> : null}
          <View style={styles.modalActions}>
            <Button testID="revoke-cancel-button" label="Cancel" tone="secondary" onPress={onCancel} />
            <Button
              testID="revoke-confirm-button"
              label={state?.phase === "publishing" ? "Revoking…" : "Revoke membership"}
              tone="danger"
              disabled={state?.phase === "publishing"}
              onPress={onConfirm}
            />
          </View>
        </Panel>
      </View>
    </Modal>
  );
}

type RoleDraft = {
  key: string;
  d: string;
  name: string;
  description: string;
  permissions: Permission[];
  isNew: boolean;
};

function draftFromRole(role: RoleSummary): RoleDraft {
  return {
    key: `${role.address}:${role.name}:${role.permissions.join(",")}`,
    d: role.d,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    isNew: false,
  };
}

function PeopleSurface() {
  const { venue } = useVenue();
  const breakpoint = useBreakpoint();
  const wide = breakpoint === "tablet";
  const [tab, setTab] = useState<Tab>("people");
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ person: Person; award: PersonAward } | null>(null);
  const [revocations, setRevocations] = useState<RevocationInput[]>([]);
  const [revokeState, setRevokeState] = useState<MutationState | undefined>(undefined);
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [roleSaveState, setRoleSaveState] = useState<MutationState | undefined>(undefined);
  const [assignDraft, setAssignDraft] = useState({ pubkey: "", expiry: "" });
  const [assignState, setAssignState] = useState<MutationState | undefined>(undefined);
  const [assignValidation, setAssignValidation] = useState<string | null>(null);

  // Synchronous in-flight guards (ORDER-05 pattern): a double-tap can deliver
  // both presses before React commits state, so refs gate the publish paths.
  const revokeInFlight = useRef(false);
  const roleSaveInFlight = useRef(false);
  const assignInFlight = useRef(false);

  const [retryKey, setRetryKey] = useState(0);
  const { status, people, roles, error } = usePeople(revocations, retryKey);

  const venueHost = venue?.relayUrl.replace(/^wss?:\/\//, "") ?? "this venue";
  const selectedPerson = people.find((person) => person.pubkey === selectedPubkey);
  const selectedRole = useMemo(() => {
    if (roles.length === 0) return undefined;
    if (roleDraft && !roleDraft.isNew) return roles.find((role) => role.d === roleDraft.d) ?? roles[0];
    return roles[0];
  }, [roles, roleDraft]);

  const beginRevoke = (person: Person, award: PersonAward) => {
    setRevokeState(undefined);
    setRevokeTarget({ person, award });
  };

  const confirmRevoke = () => {
    if (!venue || !revokeTarget || revokeInFlight.current) return;
    revokeInFlight.current = true;
    setRevokeState({ phase: "publishing" });
    void (async () => {
      // PEOPLE-04: kind 5 referencing the exact award id, confirmed only
      // after an affirmative relay acknowledgement.
      const template = buildRevocation({ awardId: revokeTarget.award.id });
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "membership_revocation");
      if (__DEV__) {
        console.log(`[crays-board-revoke]${JSON.stringify({ id: signed.id, e: revokeTarget.award.id })}`);
      }
      // Fold the acknowledged revocation in immediately; the relay echo of the
      // kind 5 will confirm it independently through the subscription.
      setRevocations((current) => [
        ...current,
        {
          id: signed.id,
          authorPubkey: signed.pubkey.toLowerCase(),
          awardIds: [revokeTarget.award.id],
          createdAt: signed.created_at,
        },
      ]);
      setRevokeState({ phase: "confirmed" });
      setRevokeTarget(null);
    })().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRevokeState({ phase: "error", message });
    }).finally(() => {
      revokeInFlight.current = false;
    });
  };

  const togglePermission = (permission: Permission, value: boolean) => {
    setRoleSaveState(undefined);
    setRoleDraft((current) => {
      if (!current) return current;
      const permissions = value
        ? [...current.permissions, permission]
        : current.permissions.filter((entry) => entry !== permission);
      return { ...current, permissions };
    });
  };

  const saveRole = () => {
    if (!venue || !roleDraft || roleSaveInFlight.current) return;
    roleSaveInFlight.current = true;
    setRoleSaveState({ phase: "publishing" });
    const draft = roleDraft;
    void (async () => {
      // ROLE-01/02: Save publishes the same-d 30009 role definition with the
      // final intended permission set; confirmed only after relay ack.
      const template = buildRoleDefinition({
        d: draft.d,
        name: draft.name,
        description: draft.description,
        permissions: draft.permissions,
      });
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "role_definition");
      if (__DEV__) {
        console.log(
          `[crays-board-role]${JSON.stringify({ id: signed.id, d: draft.d, permissions: draft.permissions })}`,
        );
      }
      setRoleDraft((current) =>
        current?.key === draft.key ? { ...current, isNew: false } : current,
      );
      setRoleSaveState({ phase: "confirmed" });
    })().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setRoleSaveState({ phase: "error", message });
    }).finally(() => {
      roleSaveInFlight.current = false;
    });
  };

  const assignRole = () => {
    if (!venue || !selectedRole || assignInFlight.current) return;
    assignInFlight.current = true;
    setAssignValidation(null);
    setAssignState({ phase: "publishing" });
    void (async () => {
      // ROLE-03: invalid identity or past expiry produces no write.
      const holderPubkey = resolveAssigneePubkey(assignDraft.pubkey);
      const expiresAt = parseExpiryInput(assignDraft.expiry);
      const template = buildRoleAssignment({
        roleAddress: selectedRole.address,
        holderPubkey,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "role_assignment");
      if (__DEV__) {
        console.log(
          `[crays-board-assign]${JSON.stringify({ id: signed.id, a: selectedRole.address, p: holderPubkey })}`,
        );
      }
      setAssignState({ phase: "confirmed" });
      setAssignDraft({ pubkey: "", expiry: "" });
    })().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setAssignState({ phase: "error", message });
      setAssignValidation(message);
    }).finally(() => {
      assignInFlight.current = false;
    });
  };

  const openAssignFor = (person: Person) => {
    setAssignState(undefined);
    setAssignValidation(null);
    setAssignDraft({ pubkey: person.pubkey, expiry: "" });
    if (roles.length > 0) setRoleDraft(draftFromRole(roles[0]));
    setTab("roles");
  };

  const newRole = () => {
    setRoleSaveState(undefined);
    setRoleDraft({
      key: `new:${Date.now().toString(36)}`,
      d: `role-${Date.now().toString(36)}`,
      name: "",
      description: "",
      permissions: [],
      isNew: true,
    });
  };

  if (status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lan-disconnect"
          title="Cannot reach this venue"
          description={error ?? "The venue relay or service did not answer."}
          action={<Button label="Try again" tone="secondary" onPress={() => setRetryKey((key) => key + 1)} />}
        />
      </View>
    );
  }

  const peopleList = (
    <View style={styles.listColumn}>
      {status === "loading" ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
        </View>
      ) : people.length === 0 ? (
        <EmptyState
          icon="account-group-outline"
          title="No people yet"
          description="Venue admins and membership or role holders will appear here."
        />
      ) : (
        people.map((person) => (
          <PersonRow
            key={person.pubkey}
            person={person}
            selected={person.pubkey === selectedPubkey}
            onPress={() => {
              setRevokeState(undefined);
              setSelectedPubkey(person.pubkey);
            }}
          />
        ))
      )}
    </View>
  );

  const peopleDetail = selectedPerson ? (
    <PersonDetail
      person={selectedPerson}
      venueHost={venueHost}
      {...(revokeState ? { revokeState } : {})}
      onRevoke={(award) => beginRevoke(selectedPerson, award)}
      onAssignRole={openAssignFor}
      {...(!wide ? { onBack: () => setSelectedPubkey(null) } : {})}
    />
  ) : (
    <Panel style={styles.detail}>
      <Text style={styles.personMeta}>Select a person to see their access.</Text>
    </Panel>
  );

  const roleCapReached = roles.length >= ROLE_LIMIT;

  const roleListPanel = (
    <Panel style={styles.roleList} padded>
      <Text style={styles.sectionLabel}>Configurable roles</Text>
      <Text style={styles.personMeta}>
        {roles.length} of {ROLE_LIMIT} configurable roles
      </Text>
      {roles.map((role) => {
        const selected = roleDraft && !roleDraft.isNew && roleDraft.d === role.d;
        return (
          <Pressable
            key={role.address}
            testID={`role-row-${role.d}`}
            accessibilityRole="button"
            onPress={() => {
              setRoleSaveState(undefined);
              setRoleDraft(draftFromRole(role));
            }}
            style={[styles.roleRow, selected && styles.personRowSelected]}
          >
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {role.name}
              </Text>
              <Text style={styles.personMeta}>
                {role.permissions.length} of {PERMISSIONS.length} permissions
              </Text>
            </View>
            <Text style={styles.roleChevron}>›</Text>
          </Pressable>
        );
      })}
      <Button
        testID="create-role-button"
        label="Create role"
        tone="secondary"
        disabled={roleCapReached}
        onPress={newRole}
      />
      {roleCapReached ? (
        <Text style={styles.noteText}>You can have up to {ROLE_LIMIT} configurable roles.</Text>
      ) : null}
    </Panel>
  );

  const roleEditorPanel = (
    <Panel testID="role-editor" style={styles.roleEditor}>
      {roleDraft ? (
        <>
          <Text style={styles.editorTitle}>{roleDraft.isNew ? "New role" : roleDraft.name || "Role"}</Text>
          <Field
            testID="role-name-input"
            label="Role name"
            value={roleDraft.name}
            onChangeText={(name) => {
              setRoleSaveState(undefined);
              setRoleDraft((current) => (current ? { ...current, name } : current));
            }}
          />
          <Field
            testID="role-description-input"
            label="Description"
            value={roleDraft.description}
            onChangeText={(description) => {
              setRoleSaveState(undefined);
              setRoleDraft((current) => (current ? { ...current, description } : current));
            }}
          />
          <Text style={styles.sectionLabel}>Permissions</Text>
          {PERMISSIONS.map((permission) => (
            <PermissionToggle
              key={permission}
              permission={permission}
              value={roleDraft.permissions.includes(permission)}
              disabled={roleSaveState?.phase === "publishing"}
              onChange={(value) => togglePermission(permission, value)}
            />
          ))}
          <View style={styles.roleStatusSlot}>
            {roleSaveState?.phase === "error" ? (
              <Text style={styles.errorText}>{roleSaveState.message}</Text>
            ) : null}
            {roleSaveState?.phase === "confirmed" ? <Text style={styles.successText}>Role saved</Text> : null}
          </View>
          <Button
            testID="save-role-button"
            label={roleSaveState?.phase === "publishing" ? "Saving…" : "Save role"}
            disabled={roleSaveState?.phase === "publishing"}
            onPress={saveRole}
          />
        </>
      ) : (
        <Text style={styles.personMeta}>Select a role to edit its permissions.</Text>
      )}
    </Panel>
  );

  const assignRolePanel = (
    <Panel testID="assign-panel" style={styles.assignPanel}>
      <Text style={styles.editorTitle}>Assign role</Text>
      <Text style={styles.personMeta}>
        {selectedRole ? `Grant ${selectedRole.name} to a pubkey or npub.` : "Create a role before assigning."}
      </Text>
      <Field
        testID="assign-pubkey-input"
        label="Pubkey or npub"
        value={assignDraft.pubkey}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(pubkey) => {
          setAssignState(undefined);
          setAssignValidation(null);
          setAssignDraft((current) => ({ ...current, pubkey }));
        }}
      />
      <Field
        testID="assign-expiry-input"
        label="Expiry (optional)"
        hint="YYYY-MM-DD. Blank means permanent."
        value={assignDraft.expiry}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(expiry) => {
          setAssignState(undefined);
          setAssignValidation(null);
          setAssignDraft((current) => ({ ...current, expiry }));
        }}
      />
      {assignValidation ? <Text style={styles.errorText}>{assignValidation}</Text> : null}
      {assignState?.phase === "confirmed" ? <Text style={styles.successText}>Role assigned</Text> : null}
      <Button
        testID="assign-confirm-button"
        label={assignState?.phase === "publishing" ? "Assigning…" : "Assign role"}
        disabled={!selectedRole || assignState?.phase === "publishing"}
        onPress={assignRole}
      />
    </Panel>
  );

  // Wide windows: three stable columns — role list, editor, assign — each
  // sized by flexBasis (deterministic under Yoga, unlike width on a flex
  // child) and scrolling independently, so nothing clips or collapses and
  // the assign action is never buried under the editor. Narrow windows keep
  // the single stacked scroll. Column identity survives saves, so selection
  // and scroll positions are preserved after the relay echo.
  const rolesTab = wide ? (
    <View style={styles.rolesColumns}>
      <ScrollView style={styles.roleListScroll} contentContainerStyle={styles.roleColumnContent}>
        {roleListPanel}
      </ScrollView>
      <ScrollView style={styles.roleEditorScroll} contentContainerStyle={styles.roleColumnContent}>
        {roleEditorPanel}
      </ScrollView>
      <ScrollView style={styles.roleAssignScroll} contentContainerStyle={styles.roleColumnContent}>
        {assignRolePanel}
      </ScrollView>
    </View>
  ) : (
    <ScrollView style={styles.rolesScroll} contentContainerStyle={styles.rolesScrollContent}>
      {assignDraft.pubkey || assignState?.phase === "confirmed" ? (
        <>
          {assignRolePanel}
          {roleListPanel}
          {roleEditorPanel}
        </>
      ) : (
        <>
          {roleListPanel}
          {roleEditorPanel}
          {assignRolePanel}
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={styles.surface}>
      <PeopleTabs tab={tab} onChange={setTab} />
      {tab === "people" ? (
        !wide ? (
          <ScrollView style={styles.peopleScroll} contentContainerStyle={styles.peopleScrollContent}>
            {selectedPerson ? peopleDetail : peopleList}
          </ScrollView>
        ) : (
          <View style={styles.peopleColumns}>
            <ScrollView style={styles.peopleScroll} contentContainerStyle={styles.peopleScrollContent}>
              {peopleList}
            </ScrollView>
            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.peopleScrollContent}>
              {peopleDetail}
            </ScrollView>
          </View>
        )
      ) : (
        rolesTab
      )}
      {revokeTarget ? (
        <RevokeDialog
          person={revokeTarget.person}
          award={revokeTarget.award}
          venueHost={venueHost}
          {...(revokeState ? { state: revokeState } : {})}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={confirmRevoke}
        />
      ) : null}
    </View>
  );
}

export default function PeopleRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const breakpoint = useBreakpoint();

  return (
    <AppShell active="people" permissions={ADMIN_PERMISSIONS}>
      <View testID="people-screen" style={[styles.screen, breakpoint === "phone" && styles.screenPhone]}>
        <ScreenTitle
          title="People & roles"
          description={venue ? "Give every teammate the access they need—and no more." : "No venue selected"}
        />
        {restoring ? (
          <View style={styles.center}>
            <Text style={styles.loadingText}>Restoring the venue…</Text>
          </View>
        ) : !venue ? (
          <EmptyState
            icon="store-off-outline"
            title="No venue selected"
            description="Select a venue before managing people."
            action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
          />
        ) : (
          <PeopleSurface />
        )}
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, width: "100%", maxWidth: 1280, alignSelf: "center" },
  screenPhone: { paddingHorizontal: 16, paddingTop: 18 },
  surface: { flex: 1, gap: 18 },
  tabs: { flexDirection: "row", gap: 8 },
  tabButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabButtonActive: { backgroundColor: colors.pinkSoft, borderColor: colors.pink },
  tabButtonLabel: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  tabButtonLabelActive: { color: colors.pinkDark },
  peopleColumns: { flex: 1, flexDirection: "row", gap: 18 },
  peopleScroll: { flex: 1 },
  detailScroll: { flex: 1, maxWidth: 420 },
  peopleScrollContent: { gap: 12, paddingBottom: 32 },
  listColumn: { gap: 12, flexGrow: 1 },
  personRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  personRowSelected: { borderColor: colors.pink, backgroundColor: colors.surfaceWarm },
  personCopy: { flex: 1, gap: 2, flexShrink: 1 },
  personName: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  personMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  personFacts: { alignItems: "flex-end", gap: 6 },
  pressed: { opacity: 0.78 },
  detail: { gap: 14 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  detailName: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  section: { gap: 6 },
  sectionLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  accessRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailActions: { gap: 10 },
  toggleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleCopy: { flex: 1 },
  toggleTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  toggleDescription: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(22, 10, 17, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { gap: 14, maxWidth: 440, width: "100%" },
  modalTitle: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  modalBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  successText: { color: colors.success, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  noteText: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  rolesScroll: { flex: 1, minWidth: 0 },
  rolesScrollContent: { gap: 16, paddingBottom: 32 },
  rolesColumns: { flex: 1, flexDirection: "row", gap: 16, minWidth: 0, minHeight: 0 },
  roleListScroll: { flexGrow: 0.85, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 },
  roleEditorScroll: { flexGrow: 1.25, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 },
  roleAssignScroll: { flexGrow: 1.1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 },
  roleColumnContent: { paddingBottom: 32 },
  roleList: { width: "100%", minWidth: 0, gap: 8 },
  roleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  roleChevron: { color: colors.inkFaint, fontSize: 20, lineHeight: 24 },
  roleEditor: { width: "100%", minWidth: 0, gap: 12 },
  roleStatusSlot: { minHeight: 18 },
  assignPanel: { width: "100%", minWidth: 0, gap: 12 },
  editorTitle: { color: colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "800" },
});
