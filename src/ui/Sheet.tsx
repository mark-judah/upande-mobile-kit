import { useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { KitTheme } from '../config';
import { useInsets } from './insets';
import { useTheme } from './primitives';

/** The kit's own bottom sheet, used by the support, chat, sign-in and what's-new screens. */
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
  /** Fill most of the screen (chat) instead of fitting the content. */
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
        <View style={[s.sheet, tall && s.tall, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.header}>
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
              <Ionicons name="close" size={22} color={t.textMuted} />
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
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '92%', paddingHorizontal: 16, paddingTop: 14 },
    tall: { height: '88%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 },
    title: { fontSize: 17, fontWeight: '600', color: t.text, flex: 1 },
  });
