import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { font } from '../ui/primitives';
import { openReportProblem } from './controller';
import { supportOptions } from './options';

/**
 * A ready-made "Report a problem" button for the app's own header or menu. It screenshots the screen it was pressed
 * on, then opens the report sheet. Renders nothing when `support` turns reporting off.
 */
export function ReportProblemButton({ label, size = 22, color }: { label?: string; size?: number; color?: string }) {
  const cfg = getConfig();
  if (!supportOptions(cfg.support).report) return null;
  const tint = color ?? cfg.theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? 'Report a problem'}
      onPress={() => void openReportProblem()}
      hitSlop={10}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name="bug-outline" size={size} color={tint} />
      {label ? <Text style={[font(cfg.theme, 'semiBold'), { color: tint, fontSize: 13 }]}>{label}</Text> : null}
    </Pressable>
  );
}
