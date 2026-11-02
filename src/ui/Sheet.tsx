import { useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { KitTheme } from '../config';
import { useInsets } from './insets';
import { font, fontSize, radius, shadow, spacing, useTheme } from './primitives';

/** The kit's own bottom sheet, used by the support, sign-in and what's-new screens. */
export function Sheet({
  title,
  onClose,
  children,
  tall = false,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Fill most of the screen (a conversation) instead of fitting the content. */
  tall?: boolean;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const insets = useInsets();
  const s = useMemo(() => sheetStyles(t), [t]);
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.scrim} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, tall && s.tall, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}>
          <View style={s.grabber} />
          <View style={s.header}>
            <Text style={s.title} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={18} color={t.textSecondary} />
            </Pressable>
          </View>
          <View style={tall ? { flex: 1 } : undefined}>{children}</View>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const sheetStyles = (t: KitTheme) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '92%',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      ...shadow.lg,
    },
    tall: { height: '88%' },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.md },
    title: { ...font(t, 'semiBold'), fontSize: fontSize.lg, color: t.text, flex: 1, letterSpacing: -0.3 },
    close: { width: 32, height: 32, borderRadius: 16, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  });
