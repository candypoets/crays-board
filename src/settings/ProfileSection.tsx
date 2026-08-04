import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Button, Field, Panel } from "@/components/ui";
import { publishEvent } from "@/nostr/publish";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

import type { VenueProfile } from "./fold";
import { buildVenueProfile, MAX_DESCRIPTION_LENGTH, validateProfileDraft } from "./protocol";

type SaveState = { phase: "idle" } | { phase: "publishing" } | { phase: "saved" } | { phase: "error"; message: string };

/**
 * Venue profile editor (PROFILE-01/02). Loads the latest addressable profile
 * from relay truth; Save validates, signs, and publishes kind 30078 at the
 * stable d=nuts-community-profile to the venue relay only — confirmed only
 * after an affirmative relay acknowledgement.
 */
export function ProfileSection({ profile, loaded }: { profile: VenueProfile | null; loaded: boolean }) {
  if (!loaded) {
    return <Text style={styles.loading}>Loading the venue profile…</Text>;
  }
  // Re-arm the form only when the profile first appears (or disappears), not
  // on every relay echo: the own-save echo must not wipe the "Saved"
  // confirmation or the fields the user just typed.
  return <ProfileForm key={profile ? "loaded" : "empty"} profile={profile} />;
}

function ProfileForm({ profile }: { profile: VenueProfile | null }) {
  const { venue } = useVenue();
  const [hospitalityType, setHospitalityType] = useState(profile?.hospitalityType ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [menuUrl, setMenuUrl] = useState(profile?.menuUrl ?? "");
  const [bookingUrl, setBookingUrl] = useState(profile?.bookingUrl ?? "");
  const [save, setSave] = useState<SaveState>({ phase: "idle" });
  const inFlight = useRef(false);

  const draft = { hospitalityType, description, menuUrl, bookingUrl };
  const validationError = validateProfileDraft(draft);

  const saveProfile = () => {
    if (!venue || inFlight.current || validationError) return;
    inFlight.current = true;
    setSave({ phase: "publishing" });
    void (async () => {
      const template = buildVenueProfile(draft, profile?.venueName);
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "venue_profile");
      if (__DEV__) {
        console.log(`[crays-board-profile]${JSON.stringify({ id: signed.id, d: "nuts-community-profile" })}`);
      }
      setSave({ phase: "saved" });
    })()
      .catch((cause: unknown) => {
        setSave({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) });
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  return (
    <Panel testID="settings-profile-panel" style={styles.panel}>
      <Field
        label="Hospitality type"
        testID="settings-profile-type"
        value={hospitalityType}
        onChangeText={setHospitalityType}
        placeholder="Hospitality"
        hint="How guests see this venue classified."
      />
      <Field
        label="Description"
        testID="settings-profile-description"
        value={description}
        onChangeText={setDescription}
        placeholder="What guests should know about this venue."
        multiline
        hint={`${description.trim().length}/${MAX_DESCRIPTION_LENGTH} characters`}
      />
      <Field
        label="External menu URL (optional)"
        testID="settings-profile-menu-url"
        value={menuUrl}
        onChangeText={setMenuUrl}
        placeholder="https://…"
        autoCapitalize="none"
        keyboardType="url"
      />
      <Field
        label="Booking URL (optional)"
        testID="settings-profile-booking-url"
        value={bookingUrl}
        onChangeText={setBookingUrl}
        placeholder="https://…"
        autoCapitalize="none"
        keyboardType="url"
      />
      {validationError ? (
        <Text testID="settings-profile-error" style={styles.errorText}>
          {validationError}
        </Text>
      ) : null}
      {save.phase === "error" ? <Text style={styles.errorText}>{save.message}</Text> : null}
      <View style={styles.actions}>
        {save.phase === "saved" ? (
          <Text testID="settings-profile-saved" style={styles.savedText}>
            Saved
          </Text>
        ) : null}
        <Button
          testID="settings-profile-save"
          label={save.phase === "publishing" ? "Saving…" : save.phase === "error" ? "Retry" : "Save changes"}
          onPress={saveProfile}
          disabled={save.phase === "publishing" || validationError !== null}
        />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 16 },
  loading: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 14, marginTop: 4 },
  savedText: { color: colors.success, fontSize: 14, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
