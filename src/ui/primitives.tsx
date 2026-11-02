import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsets } from './insets';
import { getConfig, type KitDialogButton, type KitDialogIcon, type KitUi, type KitTheme } from '../config';

/**
 * Plain defaults for the widgets the screens are built from. A host with its
 * own design system passes `ui: { Screen, Card, Button, ... }` to
 * `configureMobileKit` and these are never used.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

export const useTheme = (): KitTheme => getConfig().theme;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20 } as const;

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
  // Edge-to-edge hosts draw under the status and gesture bars; keep the title and last rows clear of them.
  const insets = useInsets();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: spacing.lg + insets.top,
        paddingBottom: spacing.lg + insets.bottom,
        gap: spacing.md,
      }}
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
      <Text style={{ fontSize: fontSize.lg, color: t.text, fontFamily: t.fontBold || undefined, fontWeight: '700' }}>
        {title}
      </Text>
      {loading ? (
        <ActivityIndicator color={t.primary} />
      ) : error ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.danger }}>{error}</Text>
          {onRetry ? <DefaultButton label="Retry" onPress={onRetry} variant="outline" /> : null}
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

function DefaultCard({ title, children }: { title?: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: 12,
        padding: spacing.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.border,
      }}
    >
      {title ? (
        <Text
          style={{
            fontSize: fontSize.sm,
            color: t.textSecondary,
            fontFamily: t.fontSemiBold || undefined,
            fontWeight: '600',
            marginBottom: spacing.sm,
          }}
        >
          {title}
        </Text>
      ) : null}
      {children}
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
  const tone = color ?? t.primary;
  const filled = variant === 'primary';
  const fg = filled ? t.textOnPrimary : tone;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          minHeight: 44,
          paddingHorizontal: spacing.lg,
          borderRadius: 10,
          backgroundColor: filled ? tone : 'transparent',
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: tone,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : iconLeft ? (
        <Ionicons name={iconLeft as IconName} size={18} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontSize: fontSize.sm, fontFamily: t.fontSemiBold || undefined, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
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
    <View style={{ flexDirection: 'row', backgroundColor: t.surfaceAlt, borderRadius: 10, padding: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: on ? t.surface : 'transparent',
            }}
          >
            <Text style={{ color: on ? t.text : t.textSecondary, fontSize: fontSize.sm, fontWeight: on ? '600' : '400' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
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
