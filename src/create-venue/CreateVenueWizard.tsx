import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getActivePubkey } from "@/account/account";
import { BrandMark } from "@/components/BrandMark";
import { Badge, Button, Field, Panel, ToggleRow } from "@/components/ui";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

import { loadAttempt, clearAttempt, type CreateVenueAttempt } from "./attempts";
import {
  deriveSlug,
  emptyDraft,
  stepError,
  validateDescription,
  validateHours,
  validateVenueName,
  type SetupIntentions,
  type VenueDraft,
} from "./model";
import { createDeviceOwnerAccount, importOwnerAccount } from "./ownerAccount";
import { initialStages, provisionVenue, type ProvisionResult, type ProvisionStage } from "./provision";

/**
 * Create Venue wizard (PRD §8.2): four editable steps — Identity, Place,
 * Service & owner, Review — followed by real provisioning and a truthful
 * success surface. NOTHING is created before the deliberate step-4 Create
 * venue action (CREATE-04): no signer, relay, profile, or coordinator
 * request happens while filling the form.
 */

const STEPS = [
  { short: "Identity", title: "First, give the venue a face.", lead: "This is the identity guests discover in Crays and your team sees during service." },
  { short: "Place", title: "Put it on the map.", lead: "Location and time help guests plan a visit and keep service reports accurate." },
  { short: "Service", title: "Set up the people and service.", lead: "Choose how this device holds the owner account and which venue tools start enabled." },
  { short: "Review", title: "Everything looks ready.", lead: "Crays will create the venue under your identity. You become its first owner and can invite the team next." },
];

const INTENTION_LABELS: { key: keyof SetupIntentions; title: string; description: string }[] = [
  { key: "menu", title: "Publish a menu", description: "Plan to sell items and accept guest orders." },
  { key: "payments", title: "Set up payments", description: "Connect a payout destination before the menu goes live." },
  { key: "invites", title: "Create community invites", description: "Let trusted people invite others into the venue." },
  { key: "room", title: "Configure the room", description: "Prepare room details and hardware discovery." },
];

export function CreateVenueWizard({ onExit, onOpenVenue }: { onExit: () => void; onOpenVenue: () => void }) {
  const breakpoint = useBreakpoint();
  const phone = breakpoint === "phone";
  const insets = useSafeAreaInsets();
  const { setVenue } = useVenue();

  const [phase, setPhase] = useState<"form" | "provisioning" | "success">("form");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<VenueDraft>(emptyDraft);
  const [nameTouched, setNameTouched] = useState(false);

  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  const [accountChoice, setAccountChoice] = useState<"create" | "import" | null>(null);
  const [nsecInput, setNsecInput] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [pendingAttempt, setPendingAttempt] = useState<CreateVenueAttempt | null>(null);
  const [stages, setStages] = useState<ProvisionStage[]>(initialStages);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const submittingRef = useRef(false);

  // Mount: restore the active signer and any unfinished creation attempt
  // (as soon as a relay record exists this flow is "Resume venue setup").
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pubkey, attempt] = await Promise.all([getActivePubkey(), loadAttempt()]);
      if (cancelled) return;
      setOwnerPubkey(pubkey);
      if (attempt && attempt.phase !== "completed") setPendingAttempt(attempt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const slug = useMemo(() => deriveSlug(draft.name), [draft.name]);
  const patchDraft = (patch: Partial<VenueDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const currentError = stepError(draft, step, ownerPubkey !== null);
  const nameError = nameTouched ? validateVenueName(draft.name) : null;
  const descriptionError = validateDescription(draft.description);
  const hoursError = validateHours(draft.opensAt, draft.closesAt);

  const installAccount = async (mode: "create" | "import") => {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const pubkey = mode === "create" ? await createDeviceOwnerAccount() : await importOwnerAccount(nsecInput);
      setOwnerPubkey(pubkey);
      setNsecInput("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountBusy(false);
    }
  };

  const submit = async () => {
    // One deliberate submission drives one stable attempt; repeat taps while
    // provisioning is in flight are ignored (attempt idempotency, CREATE-06).
    if (submittingRef.current) return;
    submittingRef.current = true;
    setProvisionError(null);
    setStages(initialStages());
    setPhase("provisioning");
    try {
      const completed = await provisionVenue(draft, setStages, setVenue);
      setResult(completed);
      setPendingAttempt(null);
      if (__DEV__) {
        console.log(
          `[crays-board-create-venue]${JSON.stringify({
            attemptId: completed.attemptId,
            relayId: completed.relayId,
            relayUrl: completed.venue.relayUrl,
            serviceUrl: completed.venue.serviceUrl,
            pubkey: completed.venue.pubkey,
            slug: completed.slug,
          })}`,
        );
      }
      setPhase("success");
    } catch (error) {
      setProvisionError(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
    }
  };

  const resumeAttempt = async () => {
    if (!pendingAttempt) return;
    setDraft(pendingAttempt.draft);
    await submit();
  };

  const discardAttempt = async () => {
    // Cancellation after a relay exists never deletes it implicitly (PRD §8.2);
    // discarding only forgets the local resume pointer.
    await clearAttempt();
    setPendingAttempt(null);
  };

  if (phase === "provisioning" || phase === "success") {
    return (
      <ProvisioningOrSuccess
        phone={phone}
        phase={phase}
        stages={stages}
        error={provisionError}
        draftName={draft.name}
        slug={slug}
        address={draft.address}
        result={result}
        bottomInset={insets.bottom}
        onBackToReview={() => {
          setPhase("form");
          setStep(3);
        }}
        onOpenVenue={onOpenVenue}
      />
    );
  }

  return (
    <View style={[styles.root, phone && styles.rootPhone]}>
      {/* Progress rail (tablet) / compact stepper (phone). */}
      <View style={[styles.rail, phone && styles.railPhone]}>
        <Text style={styles.railKicker}>NEW VENUE</Text>
        {!phone ? <Text style={styles.railTitle}>Build a place people can belong to.</Text> : null}
        <View style={[styles.stepList, phone && styles.stepListPhone]}>
          {STEPS.map((item, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <Pressable
                key={item.short}
                testID={`cv-step-${item.short.toLowerCase()}`}
                disabled={index > step}
                onPress={() => setStep(index)}
                accessibilityRole="button"
                style={[styles.stepItem, phone && styles.stepItemPhone]}
              >
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? <MaterialCommunityIcons name="check" size={14} color={colors.white} /> : <Text style={styles.stepDotText}>{index + 1}</Text>}
                </View>
                <Text style={[styles.stepLabel, phone && styles.stepLabelPhone, active && styles.stepLabelActive]}>{item.short}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.stage}>
        <ScrollView contentContainerStyle={[styles.formScroll, phone && styles.formScrollPhone]} keyboardShouldPersistTaps="handled">
          <View style={styles.formTop}>
            <Pressable testID="cv-exit" accessibilityRole="button" accessibilityLabel="Exit setup" onPress={onExit} style={styles.exit}>
              <MaterialCommunityIcons name="close" size={20} color={colors.inkMuted} />
              <Text style={styles.exitText}>Exit setup</Text>
            </Pressable>
            <Text style={styles.stepCount}>{step + 1} / {STEPS.length}</Text>
          </View>

          {pendingAttempt ? (
            <Panel style={styles.resumePanel} testID="cv-resume-panel">
              <Text style={styles.resumeTitle}>Resume venue setup</Text>
              <Text style={styles.resumeCopy}>
                A venue relay was already reserved for “{pendingAttempt.draft.name}”. Resume reconciles that same
                attempt instead of creating another venue.
              </Text>
              <View style={styles.resumeActions}>
                <Button label="Resume venue setup" testID="cv-resume-button" onPress={() => void resumeAttempt()} />
                <Button label="Discard draft" tone="quiet" testID="cv-discard-attempt-button" onPress={() => void discardAttempt()} />
              </View>
            </Panel>
          ) : null}

          <Text style={[styles.formTitle, phone && styles.formTitlePhone]}>{STEPS[step].title}</Text>
          <Text style={styles.formLead}>{STEPS[step].lead}</Text>

          {step === 0 ? (
            <IdentityStep
              draft={draft}
              slug={slug}
              nameError={nameError}
              descriptionError={descriptionError}
              onName={(name) => {
                setNameTouched(true);
                patchDraft({ name });
              }}
              onDescription={(description) => patchDraft({ description })}
            />
          ) : null}

          {step === 1 ? <PlaceStep draft={draft} hoursError={hoursError} onChange={patchDraft} /> : null}

          {step === 2 ? (
            <ServiceStep
              draft={draft}
              ownerPubkey={ownerPubkey}
              accountChoice={accountChoice}
              nsecInput={nsecInput}
              accountBusy={accountBusy}
              accountError={accountError}
              onChoose={setAccountChoice}
              onNsec={setNsecInput}
              onInstall={(mode) => void installAccount(mode)}
              onChange={patchDraft}
            />
          ) : null}

          {step === 3 ? <ReviewStep draft={draft} slug={slug} ownerPubkey={ownerPubkey} onEdit={setStep} /> : null}
        </ScrollView>

        <View style={[styles.footer, phone && styles.footerPhone]}>
          <Button label={step === 0 ? "Cancel" : "Back"} tone="quiet" testID="cv-back" onPress={step === 0 ? onExit : () => setStep(step - 1)} />
          {step < STEPS.length - 1 ? (
            <Button label="Continue" icon="arrow-right" testID="cv-continue" disabled={currentError !== null} onPress={() => setStep(step + 1)} />
          ) : (
            <Button label="Create venue" icon="creation" testID="cv-submit" onPress={() => void submit()} />
          )}
        </View>
      </View>
    </View>
  );
}

function IdentityStep({
  draft,
  slug,
  nameError,
  descriptionError,
  onName,
  onDescription,
}: {
  draft: VenueDraft;
  slug: string;
  nameError: string | null;
  descriptionError: string | null;
  onName: (name: string) => void;
  onDescription: (description: string) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <Field
        label="Venue name"
        testID="cv-name-input"
        value={draft.name}
        onChangeText={onName}
        placeholder="e.g. Maison Crays"
        autoCapitalize="words"
        maxLength={60}
      />
      {nameError ? <Text testID="cv-name-error" style={styles.fieldError}>{nameError}</Text> : null}
      <View style={styles.slugRow}>
        <Text style={styles.slugLabel}>Relay slug</Text>
        <Text testID="cv-slug" style={styles.slugValue}>{slug}</Text>
      </View>
      <Field
        label="A short introduction (optional)"
        testID="cv-description-input"
        value={draft.description}
        onChangeText={onDescription}
        placeholder="Food, music, and room for a good conversation."
        multiline
        maxLength={220}
        hint={`${draft.description.length}/200 characters`}
      />
      {descriptionError ? <Text testID="cv-description-error" style={styles.fieldError}>{descriptionError}</Text> : null}

      <Text style={styles.previewKicker}>GUEST PREVIEW</Text>
      <View style={styles.preview}>
        <View style={styles.previewMark}><BrandMark size={30} /></View>
        <View style={styles.previewCopy}>
          <Text style={styles.previewName}>{draft.name.trim() || "Your venue"}</Text>
          <Text style={styles.previewHandle}>@{slug}</Text>
          <Text style={styles.previewAbout}>{draft.description.trim() || "A short introduction helps people understand what makes this place special."}</Text>
        </View>
      </View>
    </View>
  );
}

function PlaceStep({
  draft,
  hoursError,
  onChange,
}: {
  draft: VenueDraft;
  hoursError: string | null;
  onChange: (patch: Partial<VenueDraft>) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <Field
        label="Timezone"
        testID="cv-timezone-input"
        value={draft.timezone}
        onChangeText={(timezone) => onChange({ timezone })}
        placeholder="Europe/Luxembourg"
        autoCapitalize="none"
        hint="Suggested from this device. Timezone is venue data, not just formatting."
      />
      <Field
        label="Address or location label (optional)"
        testID="cv-address-input"
        value={draft.address}
        onChangeText={(address) => onChange({ address })}
        placeholder="12 Rue du Marché, Luxembourg City"
      />
      <Text style={styles.hoursTitle}>Opening hours (optional)</Text>
      <View style={styles.hoursRow}>
        <View style={styles.hoursField}>
          <Field
            label="Opens"
            testID="cv-opens-input"
            value={draft.opensAt}
            onChangeText={(opensAt) => onChange({ opensAt })}
            placeholder="18:00"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.hoursField}>
          <Field
            label="Closes"
            testID="cv-closes-input"
            value={draft.closesAt}
            onChangeText={(closesAt) => onChange({ closesAt })}
            placeholder="23:00"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
      {hoursError ? <Text testID="cv-hours-error" style={styles.fieldError}>{hoursError}</Text> : null}
      <Text style={styles.hoursHint}>
        Address and hours stay in your setup draft until the venue-profile contract for them is finalized; they are
        never silently published or discarded.
      </Text>
    </View>
  );
}

function ServiceStep({
  draft,
  ownerPubkey,
  accountChoice,
  nsecInput,
  accountBusy,
  accountError,
  onChoose,
  onNsec,
  onInstall,
  onChange,
}: {
  draft: VenueDraft;
  ownerPubkey: string | null;
  accountChoice: "create" | "import" | null;
  nsecInput: string;
  accountBusy: boolean;
  accountError: string | null;
  onChoose: (choice: "create" | "import") => void;
  onNsec: (value: string) => void;
  onInstall: (mode: "create" | "import") => void;
  onChange: (patch: Partial<VenueDraft>) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <Panel style={styles.accountPanel}>
        <Text style={styles.panelTitle}>Owner account</Text>
        {ownerPubkey ? (
          <View style={styles.accountReady} testID="cv-account-created">
            <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.success} />
            <View style={styles.accountReadyCopy}>
              <Text style={styles.accountReadyTitle}>Staff account active on this device</Text>
              <Text style={styles.accountReadyKey}>{ownerPubkey.slice(0, 12)}…{ownerPubkey.slice(-6)}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.accountChoices}>
            <Pressable
              testID="cv-create-account-button"
              accessibilityRole="button"
              disabled={accountBusy}
              onPress={() => {
                onChoose("create");
                onInstall("create");
              }}
              style={styles.accountChoice}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={22} color={colors.pink} />
              <View style={styles.accountChoiceCopy}>
                <Text style={styles.accountChoiceTitle}>Create staff account on this device</Text>
                <Text style={styles.accountChoiceHint}>Protected by secure device storage.</Text>
              </View>
              {accountBusy && accountChoice === "create" ? <ActivityIndicator color={colors.pink} /> : null}
            </Pressable>
            <Pressable
              testID="cv-import-account-button"
              accessibilityRole="button"
              disabled={accountBusy}
              onPress={() => onChoose("import")}
              style={styles.accountChoice}
            >
              <MaterialCommunityIcons name="upload-outline" size={22} color={colors.ink} />
              <View style={styles.accountChoiceCopy}>
                <Text style={styles.accountChoiceTitle}>Sign in / import existing account</Text>
                <Text style={styles.accountChoiceHint}>Use an authorized Nostr identity you already hold.</Text>
              </View>
            </Pressable>
            {accountChoice === "import" ? (
              <View style={styles.importBox}>
                <TextInput
                  testID="cv-nsec-input"
                  accessibilityLabel="Account secret"
                  value={nsecInput}
                  onChangeText={onNsec}
                  placeholder="nsec1…"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  style={styles.importInput}
                />
                <Button
                  label={accountBusy ? "Importing…" : "Import account"}
                  testID="cv-import-confirm-button"
                  disabled={accountBusy || !nsecInput.trim().startsWith("nsec1")}
                  onPress={() => onInstall("import")}
                />
              </View>
            ) : null}
          </View>
        )}
        {accountError ? <Text testID="cv-account-error" style={styles.fieldError}>{accountError}</Text> : null}
      </Panel>

      <Field
        label="Owner display name (optional)"
        testID="cv-owner-name-input"
        value={draft.ownerName}
        onChangeText={(ownerName) => onChange({ ownerName })}
        placeholder="Mina Alvarez"
        autoCapitalize="words"
      />

      <Pressable
        testID="cv-recovery-checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: draft.recoveryAcknowledged }}
        onPress={() => onChange({ recoveryAcknowledged: !draft.recoveryAcknowledged })}
        style={styles.recoveryRow}
      >
        <View style={[styles.checkbox, draft.recoveryAcknowledged && styles.checkboxChecked]}>
          {draft.recoveryAcknowledged ? <MaterialCommunityIcons name="check" size={16} color={colors.white} /> : null}
        </View>
        <Text style={styles.recoveryText}>I understand how this account can be recovered.</Text>
      </Pressable>
      <Text style={styles.recoveryHint}>
        This device holds the account key in secure storage. Losing the device without a recovery method loses venue
        access.
      </Text>

      <Panel style={styles.intentionsPanel} padded={false}>
        {INTENTION_LABELS.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            description={item.description}
            value={draft.intentions[item.key]}
            onValueChange={(value) => onChange({ intentions: { ...draft.intentions, [item.key]: value } })}
          />
        ))}
      </Panel>
      <Text style={styles.intentionsHint}>
        These are setup intentions only — nothing is configured or published until the corresponding real setup
        completes.
      </Text>
    </View>
  );
}

function ReviewStep({
  draft,
  slug,
  ownerPubkey,
  onEdit,
}: {
  draft: VenueDraft;
  slug: string;
  ownerPubkey: string | null;
  onEdit: (step: number) => void;
}) {
  const hours = draft.opensAt && draft.closesAt ? `${draft.opensAt}–${draft.closesAt}` : "Not provided";
  const intentions = INTENTION_LABELS.filter((item) => draft.intentions[item.key]).map((item) => item.title);
  const rows: { label: string; value: string; step: number; id: string }[] = [
    { label: "Venue", value: `${draft.name.trim()} · @${slug}`, step: 0, id: "identity" },
    { label: "Introduction", value: draft.description.trim() || "Not provided", step: 0, id: "identity" },
    { label: "Timezone", value: draft.timezone, step: 1, id: "place" },
    { label: "Address", value: draft.address.trim() || "Not provided", step: 1, id: "place" },
    { label: "Opening hours", value: hours, step: 1, id: "place" },
    {
      label: "Owner",
      value: `${draft.ownerName.trim() || "Unnamed"} · ${ownerPubkey ? `${ownerPubkey.slice(0, 8)}…` : "no account"}`,
      step: 2,
      id: "service",
    },
    { label: "Recovery", value: draft.recoveryAcknowledged ? "Acknowledged" : "Not acknowledged", step: 2, id: "service" },
    { label: "Setup intentions", value: intentions.length ? intentions.join(", ") : "None", step: 2, id: "service" },
  ];
  return (
    <View style={styles.stepBody}>
      <Panel style={styles.reviewPanel} padded={false} testID="cv-review">
        {rows.map((row, index) => (
          <View key={`${row.label}-${index}`} style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>{row.label}</Text>
            <Text style={styles.reviewValue} numberOfLines={2}>{row.value}</Text>
            <Pressable
              testID={`cv-edit-${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${row.label}`}
              onPress={() => onEdit(row.step)}
              style={styles.reviewEdit}
            >
              <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.pinkDark} />
              <Text style={styles.reviewEditText}>Edit</Text>
            </Pressable>
          </View>
        ))}
      </Panel>
      <View style={styles.ownerNote}>
        <MaterialCommunityIcons name="shield-account-outline" size={22} color={colors.success} />
        <Text style={styles.ownerNoteText}>
          Create venue provisions real venue infrastructure: a dedicated venue relay owned by your account, with the
          venue profile published to it.
        </Text>
      </View>
    </View>
  );
}

function ProvisioningOrSuccess({
  phone,
  phase,
  stages,
  error,
  draftName,
  slug,
  address,
  result,
  bottomInset,
  onBackToReview,
  onOpenVenue,
}: {
  phone: boolean;
  phase: "provisioning" | "success";
  stages: ProvisionStage[];
  error: string | null;
  draftName: string;
  slug: string;
  address: string;
  result: ProvisionResult | null;
  bottomInset: number;
  onBackToReview: () => void;
  onOpenVenue: () => void;
}) {
  if (phase === "success" && result) {
    const truth: { label: string; value: string; tone: "success" | "warning" }[] = [
      { label: "Venue relay", value: "Ready", tone: "success" },
      { label: "Venue profile", value: "Published", tone: "success" },
      { label: "Directory listing", value: "Not configured yet", tone: "warning" },
      { label: "Room discovery", value: "Action needed", tone: "warning" },
    ];
    return (
      <View testID="create-venue-success-screen" style={styles.successScreen}>
        <ScrollView contentContainerStyle={[styles.successWrap, phone && styles.successWrapPhone]}>
          <Badge label="Venue created" tone="success" />
          <Text style={[styles.successTitle, phone && styles.successTitlePhone]}>{draftName.trim()} is ready to welcome people.</Text>
          <Text style={styles.successCopy}>The venue profile is published and this device has Owner access.</Text>

          <Panel style={styles.truthPanel} padded={false}>
            {truth.map((row) => (
              <View key={row.label} style={styles.truthRow}>
                <Text style={styles.truthLabel}>{row.label}</Text>
                <Badge label={row.value} tone={row.tone} />
              </View>
            ))}
          </Panel>

          <Panel style={styles.venueCard}>
            <View style={styles.venueMark}><BrandMark size={30} /></View>
            <View style={styles.venueCardCopy}>
              <Text style={styles.venueCardName}>{draftName.trim()}</Text>
              <Text style={styles.venueCardSlug}>@{slug}</Text>
              {address.trim() ? <Text style={styles.venueCardMeta}>{address.trim()}</Text> : null}
            </View>
          </Panel>
        </ScrollView>

        <View style={[styles.successAction, { paddingBottom: Math.max(bottomInset, 12) }]}>
          <View style={styles.successActionInner}>
            <Button label="Open venue" icon="arrow-right" testID="cv-open-venue-button" onPress={onOpenVenue} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View testID="create-venue-provisioning" style={styles.provisioningWrap}>
      <Text style={styles.formTitle}>We’re preparing {draftName.trim()}.</Text>
      <Text style={styles.formLead}>You can leave this screen. Setup will resume safely on this device.</Text>
      <View style={styles.stageList}>
        {stages.map((stage) => (
          <View key={stage.id} testID={`cv-stage-${stage.id}`} style={styles.stageRow}>
            <View style={[
              styles.stageIcon,
              stage.status === "done" && styles.stageIconDone,
              stage.status === "running" && styles.stageIconRunning,
              stage.status === "failed" && styles.stageIconFailed,
            ]}>
              {stage.status === "running" ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <MaterialCommunityIcons
                  name={stage.status === "done" ? "check" : stage.status === "failed" ? "alert" : "circle-outline"}
                  size={16}
                  color={stage.status === "waiting" ? colors.inkFaint : colors.white}
                />
              )}
            </View>
            <View style={styles.stageCopy}>
              <Text style={styles.stageLabel}>{stage.label}</Text>
              <Text style={styles.stageStatus}>
                {stage.status === "waiting" ? "Waiting" : stage.status === "running" ? "Running…" : stage.status === "done" ? "Completed" : "Needs attention"}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {error ? (
        <View style={styles.errorPanel}>
          <Text testID="cv-provisioning-error" style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>
            If a venue relay was already reserved, coming back offers Resume venue setup and reconciles the same
            attempt — it never creates a second venue.
          </Text>
          <Button label="Back to review" tone="secondary" testID="cv-provisioning-back" onPress={onBackToReview} />
        </View>
      ) : (
        <Text style={styles.provisioningHint}>Usually under two minutes.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.paper },
  rootPhone: { flexDirection: "column" },
  rail: { width: 240, backgroundColor: colors.night, padding: 24, gap: 18 },
  railPhone: { width: "100%", paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  railKicker: { color: colors.coral, fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 1 },
  railTitle: { color: colors.white, fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.5 },
  stepList: { gap: 6, marginTop: 8 },
  stepListPhone: { flexDirection: "row", justifyContent: "space-between", marginTop: 0 },
  stepItem: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, paddingHorizontal: 8 },
  stepItemPhone: { flexDirection: "column", gap: 4, paddingHorizontal: 4 },
  stepDot: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.nightRaised, borderWidth: 1, borderColor: colors.nightBorder, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  stepDotDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepDotText: { color: colors.pinkSoft, fontSize: 12, fontWeight: "800" },
  stepLabel: { color: "#CDAFBB", fontSize: 13, lineHeight: 17, fontWeight: "700" },
  stepLabelPhone: { fontSize: 10, lineHeight: 13 },
  stepLabelActive: { color: colors.white },
  stage: { flex: 1, backgroundColor: colors.paper },
  formScroll: { paddingHorizontal: 36, paddingTop: 22, paddingBottom: 120, maxWidth: 760, width: "100%", alignSelf: "center" },
  formScrollPhone: { paddingHorizontal: 18, paddingTop: 16 },
  formTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 30 },
  exit: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 },
  exitText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  stepCount: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  resumePanel: { marginBottom: 24, gap: 10 },
  resumeTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  resumeCopy: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  resumeActions: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  formTitle: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8, maxWidth: 620 },
  formTitlePhone: { fontSize: 25, lineHeight: 31, letterSpacing: -0.5 },
  formLead: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, maxWidth: 620, marginTop: 8 },
  stepBody: { marginTop: 26, gap: 16 },
  fieldError: { color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  slugRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  slugLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  slugValue: { color: colors.pinkDark, fontSize: 13, fontWeight: "800" },
  previewKicker: { color: colors.inkMuted, fontSize: 10, lineHeight: 14, fontWeight: "900", letterSpacing: 0.8, marginTop: 10 },
  preview: { borderRadius: 16, backgroundColor: colors.night, padding: 18, flexDirection: "row", gap: 14, alignItems: "flex-start" },
  previewMark: { width: 50, height: 50, borderRadius: 14, backgroundColor: colors.nightRaised, alignItems: "center", justifyContent: "center" },
  previewCopy: { flex: 1 },
  previewName: { color: colors.white, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  previewHandle: { color: colors.coral, fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  previewAbout: { color: "#CDAFBB", fontSize: 12, lineHeight: 17, marginTop: 8 },
  hoursTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "800", marginTop: 4 },
  hoursRow: { flexDirection: "row", gap: 14 },
  hoursField: { flex: 1 },
  hoursHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  accountPanel: { gap: 12 },
  panelTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  accountReady: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.successSoft, borderRadius: 13, padding: 14 },
  accountReadyCopy: { flex: 1 },
  accountReadyTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  accountReadyKey: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  accountChoices: { gap: 10 },
  accountChoice: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 13, padding: 14 },
  accountChoiceCopy: { flex: 1 },
  accountChoiceTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  accountChoiceHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  importBox: { gap: 10 },
  importInput: { minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.white, paddingHorizontal: 15, color: colors.ink, fontSize: 15 },
  recoveryRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  checkboxChecked: { backgroundColor: colors.pink, borderColor: colors.pink },
  recoveryText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  recoveryHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  intentionsPanel: {},
  intentionsHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  reviewPanel: { marginTop: 4 },
  reviewRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewLabel: { width: 130, color: colors.inkMuted, fontSize: 13, lineHeight: 17 },
  reviewValue: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  reviewEdit: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 },
  reviewEditText: { color: colors.pinkDark, fontSize: 12, fontWeight: "800" },
  ownerNote: { minHeight: 60, paddingHorizontal: 16, borderRadius: 15, backgroundColor: colors.successSoft, flexDirection: "row", alignItems: "center", gap: 11 },
  ownerNoteText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 78, paddingHorizontal: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border },
  footerPhone: { paddingHorizontal: 14 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  provisioningWrap: { flex: 1, backgroundColor: colors.paper, padding: 32, gap: 18, maxWidth: 640, width: "100%", alignSelf: "center" },
  stageList: { marginTop: 8, gap: 4 },
  stageRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 14 },
  stageIcon: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  stageIconDone: { backgroundColor: colors.success, borderColor: colors.success },
  stageIconRunning: { backgroundColor: colors.pink, borderColor: colors.pink },
  stageIconFailed: { backgroundColor: colors.danger, borderColor: colors.danger },
  stageCopy: { flex: 1 },
  stageLabel: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  stageStatus: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  errorPanel: { backgroundColor: colors.dangerSoft, borderRadius: 15, padding: 16, gap: 10 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  errorHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  provisioningHint: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  successScreen: { flex: 1, backgroundColor: colors.paper },
  successWrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 36, gap: 18, backgroundColor: colors.paper },
  successWrapPhone: { padding: 22 },
  successAction: { flexShrink: 0, alignItems: "center", paddingTop: 12, paddingHorizontal: 22, backgroundColor: colors.paper },
  successActionInner: { width: "100%", maxWidth: 480, alignItems: "center" },
  successTitle: { color: colors.ink, fontSize: 32, lineHeight: 39, fontWeight: "800", letterSpacing: -0.8, textAlign: "center", maxWidth: 640 },
  successTitlePhone: { fontSize: 26, lineHeight: 32 },
  successCopy: { color: colors.inkMuted, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 520 },
  truthPanel: { width: "100%", maxWidth: 480 },
  truthRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  truthLabel: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  venueCard: { width: "100%", maxWidth: 480, flexDirection: "row", alignItems: "center", gap: 14 },
  venueMark: { width: 52, height: 52, borderRadius: 15, backgroundColor: colors.night, alignItems: "center", justifyContent: "center" },
  venueCardCopy: { flex: 1 },
  venueCardName: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  venueCardSlug: { color: colors.pinkDark, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 2 },
  venueCardMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
