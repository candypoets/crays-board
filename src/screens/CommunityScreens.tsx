import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Button, Field, Panel, ScreenTitle, ToggleRow } from "@/components/ui";
import { colors } from "@/theme/colors";
import type { Area, IconName, Member } from "@/types/domain";

export function PeopleScreen({ width, members }: { width: number; members: Member[] }) {
  const phone = width < 600;
  const [view, setView] = useState<"people" | "roles">("people");

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle title="People & roles" description="Give every teammate the access they need—and no more." action={<Button label={phone ? "Invite" : "Invite person"} icon="account-plus-outline" />} />
      <View style={styles.segmented}>
        {(["people", "roles"] as const).map((option) => (
          <Pressable key={option} onPress={() => setView(option)} style={[styles.segment, view === option && styles.segmentActive]}>
            <Text style={[styles.segmentText, view === option && styles.segmentTextActive]}>{option === "people" ? "People" : "Roles & access"}</Text>
          </Pressable>
        ))}
      </View>

      {view === "people" ? (
        <Panel padded={false}>
          {members.map((member) => (
            <Pressable key={member.id} accessibilityRole="button" style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
              <View style={styles.personAvatar}><Text style={styles.personInitials}>{member.initials}</Text></View>
              <View style={styles.personCopy}><Text style={styles.personName}>{member.name}</Text><Text style={styles.personRole}>{member.role}</Text></View>
              <Badge label={member.status === "on-shift" ? "On shift" : member.status === "invited" ? "Invited" : "Offline"} tone={member.status === "on-shift" ? "success" : "neutral"} />
              {!phone ? <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkFaint} /> : null}
            </Pressable>
          ))}
        </Panel>
      ) : (
        <View style={styles.roleStack}>
          {[
            { title: "Manager", people: "1 person", copy: "Runs service, team access, and venue operations.", access: ["Orders", "Menu", "Events", "Invites", "Settings"] },
            { title: "Kitchen", people: "1 person", copy: "Manages incoming orders and item availability.", access: ["Orders", "Menu"] },
            { title: "Host", people: "1 person", copy: "Welcomes guests and manages community events.", access: ["Events", "Invites", "Moderation"] },
          ].map((role) => (
            <Panel key={role.title}>
              <View style={styles.roleHeader}><View><Text style={styles.roleTitle}>{role.title}</Text><Text style={styles.rolePeople}>{role.people}</Text></View><Button label="Edit access" tone="secondary" compact /></View>
              <Text style={styles.roleCopy}>{role.copy}</Text>
              <View style={styles.permissionList}>{role.access.map((permission) => <Badge key={permission} label={permission} tone="neutral" />)}</View>
            </Panel>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export function InvitesScreen({ width }: { width: number }) {
  const phone = width < 600;
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [role, setRole] = useState("Host");

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle title="Invites" description="Bring trusted people into this venue with a clear role from the start." action={<Button label={phone ? "Create" : "Create invite"} icon="plus" onPress={() => { setCreating(true); setCreated(false); }} />} />
      {creating ? (
        <Panel style={styles.inviteBuilder}>
          <View style={styles.inviteTitleRow}><View><Text style={styles.roleTitle}>Create a staff invite</Text><Text style={styles.roleCopy}>The link can be used once and expires in seven days.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close invite builder" onPress={() => setCreating(false)} style={styles.closeButton}><MaterialCommunityIcons name="close" size={22} color={colors.ink} /></Pressable></View>
          {!created ? (
            <>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleChoices}>{["Manager", "Kitchen", "Host", "Events"].map((option) => (
                <Pressable key={option} onPress={() => setRole(option)} style={[styles.roleChoice, role === option && styles.roleChoiceActive]}><Text style={[styles.roleChoiceText, role === option && styles.roleChoiceTextActive]}>{option}</Text></Pressable>
              ))}</View>
              <View style={styles.inviteActions}><Button label="Create secure link" icon="link-variant" onPress={() => setCreated(true)} /></View>
            </>
          ) : (
            <View style={styles.createdInvite}>
              <View style={styles.createdIcon}><MaterialCommunityIcons name="check" size={22} color={colors.success} /></View>
              <View style={styles.createdCopy}><Text style={styles.createdTitle}>{role} invite ready</Text><Text style={styles.createdLink} numberOfLines={1}>crays.life/join/maison/7JQ-PINK</Text></View>
              <Button label="Copy link" tone="secondary" compact icon="content-copy" />
            </View>
          )}
        </Panel>
      ) : null}

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Active links</Text><Text style={styles.sectionCount}>2 active</Text></View>
      <Panel padded={false}>
        {[
          { role: "Kitchen", created: "Today, 16:24", expires: "Expires in 7 days", uses: "Unused" },
          { role: "Host", created: "Yesterday, 09:10", expires: "Expires in 6 days", uses: "Unused" },
        ].map((invite) => (
          <View key={invite.role} style={styles.inviteRow}>
            <View style={styles.inviteIcon}><MaterialCommunityIcons name="ticket-confirmation-outline" size={22} color={colors.pinkDark} /></View>
            <View style={styles.inviteCopy}><Text style={styles.inviteRole}>{invite.role}</Text><Text style={styles.inviteMeta}>{invite.created} · {invite.expires}</Text></View>
            <Badge label={invite.uses} tone="info" />
            {!phone ? <Button label="Copy" tone="quiet" compact icon="content-copy" /> : null}
          </View>
        ))}
      </Panel>
    </ScrollView>
  );
}

export function SettingsScreen({ width }: { width: number }) {
  const phone = width < 600;
  const [orderAlerts, setOrderAlerts] = useState(true);
  const [readyAlerts, setReadyAlerts] = useState(true);
  const [autoAccept, setAutoAccept] = useState(false);

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle title="Venue settings" description="Identity, payments, notifications, and the rules that shape daily service." action={!phone ? <Button label="Save changes" /> : undefined} />
      <View style={[styles.settingsGrid, width < 980 && styles.settingsGridNarrow]}>
        <View style={styles.settingsNav}>
          {["Venue profile", "Service", "Payments", "Notifications", "Relays", "Danger zone"].map((label, index) => (
            <Pressable key={label} style={[styles.settingsNavItem, index === 0 && styles.settingsNavItemActive]}>
              <Text style={[styles.settingsNavText, index === 0 && styles.settingsNavTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.settingsContent}>
          <Panel>
            <Text style={styles.roleTitle}>Venue profile</Text>
            <Text style={styles.roleCopy}>The public identity guests see in Crays.</Text>
            <View style={styles.settingsFields}>
              <Field label="Venue name" defaultValue="Maison Crays" />
              <Field label="Location" defaultValue="Luxembourg City" />
              <Field label="About" defaultValue="Food, music, and room for a good conversation." multiline />
            </View>
          </Panel>
          <Panel>
            <Text style={styles.roleTitle}>Service notifications</Text>
            <Text style={styles.roleCopy}>Choose which changes should interrupt the team.</Text>
            <View style={styles.toggleList}>
              <ToggleRow title="New paid order" description="Alert this device as soon as an order arrives." value={orderAlerts} onValueChange={setOrderAlerts} />
              <ToggleRow title="Order ready" description="Notify hosts when the kitchen marks an order ready." value={readyAlerts} onValueChange={setReadyAlerts} />
              <ToggleRow title="Automatically accept paid orders" description="Skip the manual acceptance step for orders that pass validation." value={autoAccept} onValueChange={setAutoAccept} />
            </View>
          </Panel>
          {phone ? <Button label="Save changes" /> : null}
        </View>
      </View>
    </ScrollView>
  );
}

export function MoreScreen({ onNavigate }: { onNavigate: (area: Area) => void }) {
  const destinations: { area: Area; title: string; description: string; icon: IconName }[] = [
    { area: "people", title: "People & roles", description: "Team access and responsibilities", icon: "account-group-outline" },
    { area: "invites", title: "Invites", description: "Create and manage join links", icon: "ticket-confirmation-outline" },
    { area: "settings", title: "Venue settings", description: "Profile, service, payments, and relays", icon: "cog-outline" },
    { area: "create-venue", title: "Create another venue", description: "Start a new community space", icon: "plus-circle-outline" },
  ];
  return (
    <ScrollView contentContainerStyle={[styles.scroll, styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle title="More" description="Team, access, and venue administration." />
      <Panel padded={false}>
        {destinations.map((destination) => (
          <Pressable key={destination.area} accessibilityRole="button" onPress={() => onNavigate(destination.area)} style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}>
            <View style={styles.moreIcon}><MaterialCommunityIcons name={destination.icon} size={23} color={colors.pinkDark} /></View>
            <View style={styles.moreCopy}><Text style={styles.moreTitle}>{destination.title}</Text><Text style={styles.moreDescription}>{destination.description}</Text></View>
            <MaterialCommunityIcons name="chevron-right" size={23} color={colors.inkFaint} />
          </Pressable>
        ))}
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 30, paddingBottom: 54, maxWidth: 1180, width: "100%", alignSelf: "center" },
  scrollPhone: { padding: 18, paddingBottom: 36 },
  segmented: { alignSelf: "flex-start", flexDirection: "row", borderRadius: 14, padding: 4, backgroundColor: colors.surfaceWarm, marginBottom: 18 },
  segment: { minHeight: 41, borderRadius: 11, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  segmentText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  segmentTextActive: { color: colors.ink },
  personRow: { minHeight: 78, paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  personAvatar: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center" },
  personInitials: { color: colors.pinkDark, fontSize: 12, fontWeight: "900" },
  personCopy: { flex: 1 },
  personName: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  personRole: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  pressed: { opacity: 0.68 },
  roleStack: { gap: 14 },
  roleHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  roleTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  rolePeople: { color: colors.pinkDark, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 3 },
  roleCopy: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  permissionList: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 17 },
  inviteBuilder: { marginBottom: 22, backgroundColor: colors.surfaceWarm },
  inviteTitleRow: { flexDirection: "row", justifyContent: "space-between", gap: 14, marginBottom: 19 },
  closeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  fieldLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700", marginBottom: 9 },
  roleChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roleChoice: { minHeight: 44, paddingHorizontal: 15, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  roleChoiceActive: { backgroundColor: colors.night, borderColor: colors.night },
  roleChoiceText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  roleChoiceTextActive: { color: colors.white },
  inviteActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 20 },
  createdInvite: { flexDirection: "row", alignItems: "center", gap: 12 },
  createdIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.successSoft, alignItems: "center", justifyContent: "center" },
  createdCopy: { flex: 1, minWidth: 0 },
  createdTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  createdLink: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 11 },
  sectionTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  sectionCount: { color: colors.inkMuted, fontSize: 12, fontWeight: "600" },
  inviteRow: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  inviteIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center" },
  inviteCopy: { flex: 1, minWidth: 0 },
  inviteRole: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  inviteMeta: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  settingsGrid: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  settingsGridNarrow: { flexDirection: "column" },
  settingsNav: { width: 210, maxWidth: "100%", gap: 3 },
  settingsNavItem: { minHeight: 45, borderRadius: 12, paddingHorizontal: 13, justifyContent: "center" },
  settingsNavItemActive: { backgroundColor: colors.pinkSoft },
  settingsNavText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  settingsNavTextActive: { color: colors.pinkDark, fontWeight: "800" },
  settingsContent: { flex: 1, width: "100%", gap: 15 },
  settingsFields: { gap: 15, marginTop: 20 },
  toggleList: { marginTop: 10 },
  moreRow: { minHeight: 86, paddingHorizontal: 15, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  moreIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center" },
  moreCopy: { flex: 1 },
  moreTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  moreDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
});
