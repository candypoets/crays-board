import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/BrandMark";
import { Badge, Button, Field, Panel, ToggleRow } from "@/components/ui";
import { colors } from "@/theme/colors";

const steps = [
  { title: "Meet your venue", short: "Identity", icon: "storefront-outline" as const },
  { title: "Place & hours", short: "Place", icon: "map-marker-outline" as const },
  { title: "Service setup", short: "Service", icon: "room-service-outline" as const },
  { title: "Review & create", short: "Review", icon: "check-decagram-outline" as const },
];

export function CreateVenueScreen({ width, onCancel, onCreated }: { width: number; onCancel: () => void; onCreated: () => void }) {
  const phone = width < 600;
  const compact = width < 900;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [about, setAbout] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("Europe/Luxembourg");
  const [orders, setOrders] = useState(true);
  const [events, setEvents] = useState(true);
  const [invites, setInvites] = useState(true);
  const [complete, setComplete] = useState(false);

  const canContinue = useMemo(() => {
    if (step === 0) return name.trim().length >= 2 && handle.trim().length >= 2;
    if (step === 1) return city.trim().length >= 2 && timezone.trim().length >= 3;
    return true;
  }, [city, handle, name, step, timezone]);

  if (complete) {
    return (
      <ScrollView contentContainerStyle={[styles.successWrap, phone && styles.successWrapPhone]}>
        <View style={styles.successMark}><BrandMark size={68} /></View>
        <Badge label="Venue created" tone="success" />
        <Text style={[styles.successTitle, phone && styles.successTitlePhone]}>{name || "Your venue"} is ready to welcome people.</Text>
        <Text style={styles.successCopy}>Your operator space is live. Next, add the menu, invite the team, and publish the first gathering.</Text>
        <View style={styles.nextSteps}>
          {["Add the first menu item", "Invite a teammate", "Create an opening event"].map((item, index) => (
            <View key={item} style={styles.nextStep}><View style={styles.nextNumber}><Text style={styles.nextNumberText}>{index + 1}</Text></View><Text style={styles.nextStepText}>{item}</Text></View>
          ))}
        </View>
        <Button label="Open venue board" icon="arrow-right" onPress={onCreated} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.progress, compact && styles.progressCompact]}>
        <View style={[styles.progressIntro, compact && styles.progressIntroCompact]}>
          <Text style={styles.progressKicker}>NEW VENUE</Text>
          {!compact ? <Text style={styles.progressTitle}>Build a place people can belong to.</Text> : null}
          {!compact ? <Text style={styles.progressCopy}>You can change every detail later. We’ll start with what guests and staff need on day one.</Text> : null}
        </View>
        <View style={[styles.stepList, compact && styles.stepListCompact]}>
          {steps.map((item, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <Pressable key={item.title} disabled={index > step} onPress={() => setStep(index)} style={[styles.step, compact && styles.stepCompact]}>
                <View style={[styles.stepIcon, active && styles.stepIconActive, done && styles.stepIconDone]}>
                  <MaterialCommunityIcons name={done ? "check" : item.icon} size={18} color={active || done ? colors.white : colors.inkMuted} />
                </View>
                {!compact ? <View style={styles.stepCopy}><Text style={[styles.stepTitle, active && styles.stepTitleActive]}>{item.title}</Text><Text style={styles.stepMeta}>Step {index + 1} of {steps.length}</Text></View> : <Text style={[styles.stepShort, active && styles.stepTitleActive]}>{item.short}</Text>}
              </Pressable>
            );
          })}
        </View>
        {!compact ? <View style={styles.help}><MaterialCommunityIcons name="lifebuoy" size={20} color={colors.coral} /><View><Text style={styles.helpTitle}>Need a hand?</Text><Text style={styles.helpCopy}>Setup takes about 4 minutes.</Text></View></View> : null}
      </View>

      <View style={styles.formStage}>
        <ScrollView contentContainerStyle={[styles.formScroll, phone && styles.formScrollPhone]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.formTop}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.close}><MaterialCommunityIcons name="close" size={23} color={colors.ink} /><Text style={styles.closeText}>Exit setup</Text></Pressable>
            <Text style={styles.formCount}>{step + 1} / {steps.length}</Text>
          </View>

          {step === 0 ? (
            <View>
              <Text style={[styles.formTitle, phone && styles.formTitlePhone]}>First, give the venue a face.</Text>
              <Text style={styles.formLead}>This is the identity guests discover in Crays and your team sees during service.</Text>
              <View style={styles.formFields}>
                <Field label="Venue name" value={name} onChangeText={setName} placeholder="e.g. Maison Crays" autoCapitalize="words" />
                <Field label="Crays handle" value={handle} onChangeText={(value) => setHandle(value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="maison-crays" autoCapitalize="none" hint="Your public address will be crays.life/maison-crays" />
                <Field label="A short introduction" value={about} onChangeText={setAbout} placeholder="Food, music, and room for a good conversation." multiline maxLength={180} hint={`${about.length}/180 characters`} />
              </View>
              <View style={styles.previewLabel}><Text style={styles.previewLabelText}>GUEST PREVIEW</Text></View>
              <View style={styles.venuePreview}>
                <View style={styles.previewMark}><BrandMark size={35} /></View>
                <View style={styles.previewCopy}><Text style={styles.previewName}>{name || "Your venue"}</Text><Text style={styles.previewHandle}>@{handle || "venue-handle"}</Text><Text style={styles.previewAbout}>{about || "A short description will help people understand what makes this place special."}</Text></View>
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View>
              <Text style={[styles.formTitle, phone && styles.formTitlePhone]}>Put it on the map.</Text>
              <Text style={styles.formLead}>Location and time help guests plan a visit and keep service reports accurate.</Text>
              <View style={styles.formFields}>
                <Field label="City or locality" value={city} onChangeText={setCity} placeholder="Luxembourg City" autoCapitalize="words" />
                <Field label="Timezone" value={timezone} onChangeText={setTimezone} placeholder="Europe/Luxembourg" autoCapitalize="none" />
                <Field label="Street address (optional)" placeholder="Shared only when you choose to publish it" />
              </View>
              <Panel style={styles.hoursPanel}>
                <View style={styles.hoursHeader}><View><Text style={styles.panelTitle}>Opening hours</Text><Text style={styles.panelCopy}>Start with a simple weekly schedule.</Text></View><Button label="Add day" tone="quiet" compact icon="plus" /></View>
                {[["Thursday", "18:00", "23:00"], ["Friday", "18:00", "00:00"], ["Saturday", "16:00", "00:00"]].map(([day, from, until]) => (
                  <View key={day} style={styles.hoursRow}><Text style={styles.hoursDay}>{day}</Text><View style={styles.timeBox}><Text style={styles.timeText}>{from}</Text></View><Text style={styles.to}>to</Text><View style={styles.timeBox}><Text style={styles.timeText}>{until}</Text></View></View>
                ))}
              </Panel>
            </View>
          ) : null}

          {step === 2 ? (
            <View>
              <Text style={[styles.formTitle, phone && styles.formTitlePhone]}>Choose how the community meets you.</Text>
              <Text style={styles.formLead}>Turn on the parts of Crays you plan to use first. You can add the rest any time.</Text>
              <Panel style={styles.servicePanel}>
                <ToggleRow title="Accept paid orders" description="Publish a menu and receive Lightning-paid guest orders." value={orders} onValueChange={setOrders} />
                <ToggleRow title="Publish events" description="Share gatherings and track attendance." value={events} onValueChange={setEvents} />
                <ToggleRow title="Grow with invitations" description="Let trusted people invite others into the community." value={invites} onValueChange={setInvites} />
              </Panel>
              {orders ? (
                <Panel style={styles.paymentPanel}>
                  <View style={styles.paymentIcon}><MaterialCommunityIcons name="lightning-bolt" size={25} color={colors.warning} /></View>
                  <View style={styles.paymentCopy}><Text style={styles.panelTitle}>Lightning payout</Text><Text style={styles.panelCopy}>Orders need a payout destination. You can connect one now or finish it before publishing the menu.</Text></View>
                  <Button label="Connect" tone="secondary" compact />
                </Panel>
              ) : null}
            </View>
          ) : null}

          {step === 3 ? (
            <View>
              <Text style={[styles.formTitle, phone && styles.formTitlePhone]}>Everything looks ready.</Text>
              <Text style={styles.formLead}>Crays will create the venue under your identity. You become its first owner and can invite the team next.</Text>
              <Panel style={styles.review}>
                <View style={styles.reviewHero}><View style={styles.reviewMark}><BrandMark size={40} /></View><View style={styles.reviewHeroCopy}><Text style={styles.reviewName}>{name || "Untitled venue"}</Text><Text style={styles.reviewHandle}>@{handle || "venue"}</Text></View><Badge label="Private until published" tone="info" /></View>
                {[
                  ["Location", city || "Not provided", "map-marker-outline"],
                  ["Timezone", timezone, "clock-outline"],
                  ["Orders", orders ? "Enabled" : "Not yet", "receipt-text-outline"],
                  ["Events", events ? "Enabled" : "Not yet", "calendar-blank-outline"],
                  ["Invites", invites ? "Enabled" : "Not yet", "ticket-confirmation-outline"],
                ].map(([label, value, icon]) => (
                  <View key={label} style={styles.reviewRow}><MaterialCommunityIcons name={icon as never} size={20} color={colors.inkMuted} /><Text style={styles.reviewLabel}>{label}</Text><Text style={styles.reviewValue}>{value}</Text></View>
                ))}
              </Panel>
              <View style={styles.ownerNote}><MaterialCommunityIcons name="shield-account-outline" size={22} color={colors.success} /><Text style={styles.ownerNoteText}>Your account receives the Owner role with full venue permissions.</Text></View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.formFooter, phone && styles.formFooterPhone]}>
          <Button label={step === 0 ? "Cancel" : "Back"} tone="quiet" onPress={step === 0 ? onCancel : () => setStep(step - 1)} />
          <Button
            label={step === steps.length - 1 ? "Create venue" : "Continue"}
            icon={step === steps.length - 1 ? "creation" : "arrow-right"}
            disabled={!canContinue}
            onPress={() => step === steps.length - 1 ? setComplete(true) : setStep(step + 1)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.paper },
  progress: { width: 300, backgroundColor: colors.night, padding: 26 },
  progressCompact: { width: 102, paddingHorizontal: 10, paddingVertical: 18 },
  progressIntro: { marginBottom: 34 },
  progressIntroCompact: { marginBottom: 16, alignItems: "center" },
  progressKicker: { color: colors.coral, fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 1 },
  progressTitle: { color: colors.white, fontSize: 25, lineHeight: 31, fontWeight: "800", letterSpacing: -0.5, marginTop: 12 },
  progressCopy: { color: "#CDAFBB", fontSize: 13, lineHeight: 19, marginTop: 9 },
  stepList: { gap: 8 },
  stepListCompact: { alignItems: "center" },
  step: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, paddingHorizontal: 9 },
  stepCompact: { minHeight: 69, flexDirection: "column", justifyContent: "center", gap: 4, paddingHorizontal: 0 },
  stepIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.nightRaised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.nightBorder },
  stepIconActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  stepIconDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepCopy: { flex: 1 },
  stepTitle: { color: "#CDAFBB", fontSize: 13, lineHeight: 17, fontWeight: "700" },
  stepTitleActive: { color: colors.white },
  stepMeta: { color: "#947482", fontSize: 10, lineHeight: 14, marginTop: 2 },
  stepShort: { color: "#A98B97", fontSize: 9, lineHeight: 12, fontWeight: "700" },
  help: { marginTop: "auto", paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.nightBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  helpTitle: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  helpCopy: { color: "#A98B97", fontSize: 10, lineHeight: 14, marginTop: 2 },
  formStage: { flex: 1, backgroundColor: colors.paper },
  formScroll: { paddingHorizontal: 42, paddingTop: 25, paddingBottom: 110, maxWidth: 870, width: "100%", alignSelf: "center" },
  formScrollPhone: { paddingHorizontal: 18, paddingTop: 17 },
  formTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 42 },
  close: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 },
  closeText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  formCount: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  formTitle: { color: colors.ink, fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.9, maxWidth: 650 },
  formTitlePhone: { fontSize: 27, lineHeight: 33, letterSpacing: -0.5 },
  formLead: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, maxWidth: 620, marginTop: 8 },
  formFields: { gap: 18, marginTop: 29 },
  previewLabel: { marginTop: 29, marginBottom: 9 },
  previewLabelText: { color: colors.inkMuted, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 0.8 },
  venuePreview: { minHeight: 128, borderRadius: 16, backgroundColor: colors.night, padding: 19, flexDirection: "row", alignItems: "flex-start", gap: 15 },
  previewMark: { width: 55, height: 55, borderRadius: 16, backgroundColor: colors.nightRaised, alignItems: "center", justifyContent: "center" },
  previewCopy: { flex: 1 },
  previewName: { color: colors.white, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  previewHandle: { color: colors.coral, fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  previewAbout: { color: "#CDAFBB", fontSize: 12, lineHeight: 17, marginTop: 9 },
  hoursPanel: { marginTop: 26 },
  hoursHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 13 },
  panelTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  panelCopy: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  hoursRow: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border },
  hoursDay: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  timeBox: { minWidth: 72, height: 39, borderRadius: 11, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  timeText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  to: { color: colors.inkMuted, fontSize: 11 },
  servicePanel: { marginTop: 28 },
  paymentPanel: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 13 },
  paymentIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.warningSoft, alignItems: "center", justifyContent: "center" },
  paymentCopy: { flex: 1 },
  review: { marginTop: 28 },
  reviewHero: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 18, marginBottom: 3, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewMark: { width: 58, height: 58, borderRadius: 17, backgroundColor: colors.night, alignItems: "center", justifyContent: "center" },
  reviewHeroCopy: { flex: 1 },
  reviewName: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  reviewHandle: { color: colors.pinkDark, fontSize: 11, lineHeight: 15, marginTop: 2 },
  reviewRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewLabel: { flex: 1, color: colors.inkMuted, fontSize: 13, lineHeight: 17 },
  reviewValue: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  ownerNote: { minHeight: 66, paddingHorizontal: 16, marginTop: 15, borderRadius: 15, backgroundColor: colors.successSoft, flexDirection: "row", alignItems: "center", gap: 11 },
  ownerNoteText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  formFooter: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 82, paddingHorizontal: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
  formFooterPhone: { paddingHorizontal: 14 },
  successWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 40, backgroundColor: colors.paper },
  successWrapPhone: { padding: 22 },
  successMark: { width: 110, height: 110, borderRadius: 28, backgroundColor: colors.night, alignItems: "center", justifyContent: "center", marginBottom: 23 },
  successTitle: { color: colors.ink, fontSize: 34, lineHeight: 41, fontWeight: "800", letterSpacing: -0.8, textAlign: "center", maxWidth: 650, marginTop: 14 },
  successTitlePhone: { fontSize: 27, lineHeight: 33 },
  successCopy: { color: colors.inkMuted, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 520, marginTop: 9 },
  nextSteps: { width: "100%", maxWidth: 470, marginVertical: 26, borderTopWidth: 1, borderTopColor: colors.border },
  nextStep: { minHeight: 57, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  nextNumber: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center" },
  nextNumberText: { color: colors.pinkDark, fontSize: 11, fontWeight: "900" },
  nextStepText: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
});
