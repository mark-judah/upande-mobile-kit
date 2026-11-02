import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsets } from './insets';
import { getConfig, type KitDialogButton, type KitDialogIcon, type KitUi, type KitTheme } from '../config';

/**
 * The kit's look: the Upande design system (monochrome chrome, hairline cards, DM Sans / Poppins, colour for status
 * only). Everything on the kit's pages is built from the pieces in this file, so one theme change restyles all of it.
 * A host with its own widgets passes `ui: { Screen, Card, Button, ... }` to `configureMobileKit` and those replace
 * the matching defaults here.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

export const useTheme = (): KitTheme => getConfig().theme;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;

export const shadow = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 10, elevation: 6 },
} as const;

type Weight = 'regular' | 'medium' | 'semiBold' | 'bold';
const FALLBACK_WEIGHT: Record<Weight, TextStyle['fontWeight']> = { regular: '400', medium: '500', semiBold: '600', bold: '700' };

/** The font for a weight: the theme's family when it has one, else the platform font at that weight. */
export function font(t: KitTheme, weight: Weight): TextStyle {
  const family = { regular: t.fontRegular, medium: t.fontMedium, semiBold: t.fontSemiBold, bold: t.fontBold }[weight];
  return family ? { fontFamily: family } : { fontWeight: FALLBACK_WEIGHT[weight] };
}

/** The text styles of the design system. */
export function type(t: KitTheme) {
  return {
    h1: { ...font(t, 'bold'), fontSize: fontSize.xxl, color: t.text },
    h2: { ...font(t, 'bold'), fontSize: fontSize.xl, color: t.text },
    h3: { ...font(t, 'semiBold'), fontSize: fontSize.lg, color: t.text, letterSpacing: -0.3 },
    body: { ...font(t, 'regular'), fontSize: fontSize.md, color: t.text },
    small: { ...font(t, 'regular'), fontSize: fontSize.sm, color: t.textSecondary },
    caption: { ...font(t, 'medium'), fontSize: fontSize.xs, color: t.textMuted },
    label: { ...font(t, 'semiBold'), fontSize: fontSize.sm, color: t.text },
    /** The small uppercase caption above a card. */
    section: { ...font(t, 'semiBold'), fontSize: 10, color: t.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  } satisfies Record<string, TextStyle>;
}

/** A colour with transparency, `#RRGGBB` plus a 0 to 1 alpha. Anything else is returned untouched. */
export function tint(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${m[1]}${a}`;
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
/** The foreground and soft background for a status tone. */
export function toneColors(t: KitTheme, tone: Tone): { fg: string; bg: string } {
  const fg = { neutral: t.textSecondary, success: t.success, warning: t.warning, danger: t.danger, info: t.text }[tone];
  return { fg, bg: tone === 'neutral' || tone === 'info' ? t.surfaceAlt : tint(fg, 0.12) };
}

function DefaultScreen({
  title,
  children,
  loading,
  error,
  onRetry,
  onRefresh,
}: {
  title: string;
  children?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const tx = type(t);
  // Edge-to-edge hosts draw under the status and gesture bars; keep the title and last rows clear of them.
  const insets = useInsets();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: spacing.lg + insets.top,
        paddingBottom: spacing.xl + insets.bottom,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
            }}
          />
        ) : undefined
      }
    >
      <Text style={tx.h2}>{title}</Text>
      {loading ? (
        <ActivityIndicator color={t.text} />
      ) : error ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[tx.small, { color: t.danger }]}>{error}</Text>
          {onRetry ? <DefaultButton label="Retry" onPress={onRetry} variant="outline" /> : null}
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/** A white card with a hairline border. Its `title` is the small uppercase caption above it. */
function DefaultCard({ title, children }: { title?: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View>
      {title ? <Text style={[type(t).section, { marginBottom: spacing.sm }]}>{title}</Text> : null}
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: radius.md,
          padding: spacing.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function DefaultButton({
  label,
  onPress,
  variant = 'primary',
  color,
  loading,
  disabled,
  iconLeft,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: string;
  style?: object;
}) {
  const t = useTheme();
  const filled = variant === 'primary';
  // A coloured outline button (the red "Forget this device") keeps its colour; plain ones use the neutral border.
  const tone = color ?? (filled ? t.primary : t.text);
  const fg = filled ? t.textOnPrimary : tone;
  const borderColor = variant === 'outline' ? (color ? tint(color, 0.5) : t.border) : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          minHeight: 46,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: filled ? tone : pressed && variant === 'ghost' ? t.surfaceAlt : t.surface,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        variant === 'ghost' ? { backgroundColor: 'transparent' } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : iconLeft ? (
        <Ionicons name={iconLeft as IconName} size={17} color={fg} />
      ) : null}
      <Text style={[font(t, 'semiBold'), { color: fg, fontSize: fontSize.sm }]}>{label}</Text>
    </Pressable>
  );
}

/** The kit's button, whatever the host swapped in. */
export function KitButton(props: ComponentProps<typeof DefaultButton>) {
  const { Button } = ui();
  return <Button {...props} />;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 9,
              borderRadius: radius.md - 2,
              backgroundColor: on ? t.surface : 'transparent',
              ...(on ? shadow.sm : null),
            }}
          >
            <Text style={[font(t, on ? 'semiBold' : 'medium'), { color: on ? t.text : t.textSecondary, fontSize: fontSize.sm }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The design system's switch: a pill that is near-black when on. */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: () => void; disabled?: boolean }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [value, x]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onChange}
      hitSlop={8}
      style={{
        width: 46,
        height: 26,
        borderRadius: 13,
        backgroundColor: value ? t.primary : t.border,
        padding: 3,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Animated.View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#FFFFFF',
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }}
      />
    </Pressable>
  );
}

/** A label with an optional hint, and whatever belongs on the right (a switch, a value, a chevron). */
export function Row({
  label,
  hint,
  icon,
  right,
  onPress,
  last,
  tone,
}: {
  label: string;
  hint?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  /** No divider under the last row of a card. */
  last?: boolean;
  tone?: 'danger';
}) {
  const t = useTheme();
  const tx = type(t);
  const color = tone === 'danger' ? t.danger : t.text;
  const body = (
    <>
      {icon ? (
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: tone === 'danger' ? tint(t.danger, 0.1) : t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={17} color={tone === 'danger' ? t.danger : t.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[tx.label, { color }]}>{label}</Text>
        {hint ? <Text style={[tx.small, { fontSize: fontSize.xs, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={17} color={t.textMuted} /> : null}
    </>
  );
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: t.border,
  };
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.6 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={base}>{body}</View>
  );
}

/** A label and its value on one line (the version rows). */
export function InfoRow({ label, value, last, strong }: { label: string; value: string; last?: boolean; strong?: boolean }) {
  const t = useTheme();
  const tx = type(t);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: t.border,
      }}
    >
      <Text style={[tx.small, { flexShrink: 0 }]}>{label}</Text>
      <Text style={[strong ? tx.label : { ...tx.label, ...font(t, 'regular') }, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** A small status chip: a dot and a word. */
export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = useTheme();
  const { fg, bg } = toneColors(t, tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.full, backgroundColor: bg }}>
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />}
      <Text style={[font(t, 'semiBold'), { color: fg, fontSize: fontSize.xs }]}>{label}</Text>
    </View>
  );
}

/** A round icon in a soft circle, with a title and a line of explanation. */
export function EmptyState({ icon, title, subtitle, children }: { icon: IconName; title: string; subtitle?: string; children?: ReactNode }) {
  const t = useTheme();
  const tx = type(t);
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xs }}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
        <Ionicons name={icon} size={26} color={t.textMuted} />
      </View>
      <Text style={[tx.label, { fontSize: fontSize.md, textAlign: 'center' }]}>{title}</Text>
      {subtitle ? <Text style={[tx.small, { textAlign: 'center', lineHeight: 19 }]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/** A number or word with a small uppercase caption, in a bordered tile (the design system's stat card). */
export function StatTile({ label, value, hint, icon, tone }: { label: string; value: string; hint?: string; icon?: IconName; tone?: Tone }) {
  const t = useTheme();
  const accent = toneColors(t, tone ?? 'neutral').fg === t.textSecondary ? t.text : toneColors(t, tone ?? 'neutral').fg;
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
      {icon ? (
        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: tint(accent, 0.1), alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
          <Ionicons name={icon} size={15} color={accent} />
        </View>
      ) : null}
      <Text style={[type(t).caption, { textTransform: 'uppercase', letterSpacing: 0.5 }]} numberOfLines={1}>{label}</Text>
      <Text style={[font(t, 'bold'), { fontSize: fontSize.lg, color: t.text, marginTop: 3 }]} numberOfLines={1}>{value}</Text>
      {hint ? <Text style={[type(t).small, { fontSize: fontSize.xs, marginTop: 2 }]} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

/** Fallback toast: a plain alert. */
function useAlertToast() {
  return {
    showSuccess: (message: string) => Alert.alert('Done', message),
    showError: (message: string) => Alert.alert('Something went wrong', message),
  };
}

function alertDialog(title: string, message: string, buttons: KitDialogButton[], _icon?: KitDialogIcon) {
  Alert.alert(title, message, buttons);
}

const useAlwaysOnline = () => true;

type Resolved = Required<Pick<KitUi, 'Screen' | 'Card' | 'Button' | 'useToast' | 'showDialog' | 'useOnline'>>;

/** The host's widgets where given, the defaults otherwise. */
export function ui(): Resolved {
  const u = getConfig().ui ?? {};
  return {
    Screen: u.Screen ?? DefaultScreen,
    Card: u.Card ?? DefaultCard,
    Button: u.Button ?? DefaultButton,
    useToast: u.useToast ?? useAlertToast,
    showDialog: u.showDialog ?? alertDialog,
    useOnline: u.useOnline ?? useAlwaysOnline,
  };
}

/** Re-render-safe debounce for search boxes. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
