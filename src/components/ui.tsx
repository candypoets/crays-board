import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colors } from "@/theme/colors";
import type { IconName } from "@/types/domain";

export function ScreenTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 600;
  return (
    <View style={[styles.titleRow, phone && styles.titleRowPhone]}>
      <View style={[styles.titleCopy, phone && styles.titleCopyPhone]}>
        <Text style={[styles.title, phone && styles.titlePhone]}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {action ? <View style={[styles.titleAction, phone && styles.titleActionPhone]}>{action}</View> : null}
    </View>
  );
}

export function Button({
  label,
  icon,
  onPress,
  tone = "primary",
  disabled = false,
  compact = false,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  compact?: boolean;
  testID?: string;
}) {
  const foreground = tone === "primary" || tone === "danger" ? colors.white : colors.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        tone === "primary" && styles.buttonPrimary,
        tone === "secondary" && styles.buttonSecondary,
        tone === "quiet" && styles.buttonQuiet,
        tone === "danger" && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={19} color={foreground} /> : null}
      <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "pink" | "success" | "warning" | "danger" | "info";
}) {
  const palette = {
    neutral: [colors.surfaceWarm, colors.inkMuted],
    pink: [colors.pinkSoft, colors.pinkDark],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    info: [colors.infoSoft, colors.info],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette[0] }]}>
      <Text style={[styles.badgeText, { color: palette[1] }]}>{label}</Text>
    </View>
  );
}

export function Panel({
  children,
  style,
  padded = true,
  testID,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[]; padded?: boolean; testID?: string }>) {
  return <View testID={testID} style={[styles.panel, padded && styles.panelPadded, style]}>{children}</View>;
}

export function Field({
  label,
  hint,
  multiline,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        placeholderTextColor={colors.inkFaint}
        style={[styles.input, multiline && styles.inputMultiline]}
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.borderStrong, true: colors.pinkSoft }}
        thumbColor={value ? colors.pink : colors.white}
      />
    </View>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={icon} size={26} color={colors.pink} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 20, marginBottom: 28 },
  titleRowPhone: { flexDirection: "column", alignItems: "stretch", gap: 14, marginBottom: 20 },
  titleCopy: { flex: 1, minWidth: 0, maxWidth: 720 },
  titleCopyPhone: { flexGrow: 0, flexBasis: "auto", width: "100%" },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  titlePhone: { fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  description: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: 6 },
  titleAction: { flexShrink: 0 },
  titleActionPhone: { alignSelf: "stretch" },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonCompact: { minHeight: 42, paddingHorizontal: 14, borderRadius: 12 },
  buttonPrimary: { backgroundColor: colors.pink },
  buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.borderStrong },
  buttonQuiet: { backgroundColor: "transparent" },
  buttonDanger: { backgroundColor: colors.danger },
  buttonLabel: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.42 },
  badge: { minHeight: 26, borderRadius: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: "800" },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: "hidden" },
  panelPadded: { padding: 20 },
  field: { gap: 7 },
  fieldLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  input: { minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.white, paddingHorizontal: 15, color: colors.ink, fontSize: 15 },
  inputMultiline: { minHeight: 106, paddingTop: 14, textAlignVertical: "top" },
  fieldHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  toggleRow: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  toggleCopy: { flex: 1 },
  toggleTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  toggleDescription: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: 28 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800", textAlign: "center" },
  emptyDescription: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 360, marginTop: 6, marginBottom: 18 },
});
