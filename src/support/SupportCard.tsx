import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { Row, Toggle, font, fontSize, ui, useTheme } from '../ui/primitives';
import { SupportInbox } from './SupportInbox';
import { ReportIssueModal } from './ReportIssueModal';
import { fetchReportsOverview } from './support-api';
import { reportsHint } from './thread-logic';
import { disableReplyNotifications, enableReplyNotifications, isPushSupported, pushEnabled, pushStatusMessage } from '../push';
import { supportOptions } from './options';

type Overview = { mode: 'issue' | 'chat'; open: number; total: number; unread: number };

/**
 * The "Help" card in Settings: report a problem, My reports (every report and question with its status, the
 * answers and each change of status), ask support and reply notifications.
 */
export function SupportCard() {
  const cfg = getConfig();
  const { Card, useToast } = ui();
  const { showSuccess, showError } = useToast();
  const t = useTheme();
  const opts = supportOptions(cfg.support);
  const [open, setOpen] = useState<'report' | 'chat' | 'ask' | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const pushSupported = opts.chat && isPushSupported();
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    if (pushSupported) void pushEnabled().then(setPushOn);
  }, [pushSupported]);
  const togglePush = async () => {
    if (pushOn) {
      setPushOn(false);
      await disableReplyNotifications();
      return;
    }
    const status = await enableReplyNotifications();
    setPushOn(status === 'ok');
    if (status === 'ok') showSuccess(pushStatusMessage(status));
    else showError(pushStatusMessage(status));
  };
  const signedIn = !!cfg.useAuth().user || cfg.standIns.useAuth;

  useEffect(() => {
    if (!opts.chat || !signedIn || open) return;
    fetchReportsOverview().then(setOverview, () => {});
  }, [opts.chat, signedIn, open]);

  if (!opts.report && !opts.chat) return null;

  const unread = overview?.unread ?? 0;
  const chatMode = overview?.mode === 'chat';
  const badge = unread ? (
    <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
      <Text style={[font(t, 'bold'), { color: '#FFFFFF', fontSize: fontSize.xs }]}>{unread > 9 ? '9+' : unread}</Text>
    </View>
  ) : null;
  const chevronWith = (extra: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {extra}
      <Ionicons name="chevron-forward" size={17} color={t.textMuted} />
    </View>
  );

  const rows: ((last: boolean) => React.ReactNode)[] = [];
  if (opts.report) rows.push((last) => <Row key="report" icon="bug-outline" label="Report a problem" hint="Send us a screenshot and what went wrong" onPress={() => setOpen('report')} last={last} />);
  if (opts.chat && chatMode) {
    rows.push((last) => <Row key="chat" icon="chatbubbles-outline" label="Chat with support" hint="Ask a question and get a reply here" right={chevronWith(badge)} onPress={() => setOpen('chat')} last={last} />);
  } else if (opts.chat) {
    rows.push((last) => (
      <Row
        key="reports"
        icon="albums-outline"
        label="My reports"
        hint={overview ? reportsHint(overview) : 'Your reports, support answers and status changes'}
        right={chevronWith(badge)}
        onPress={() => setOpen('chat')}
        last={last}
      />
    ));
    rows.push((last) => <Row key="ask" icon="chatbubble-ellipses-outline" label="Ask support" hint="Start a conversation with the team" onPress={() => setOpen('ask')} last={last} />);
  }
  if (pushSupported) rows.push((last) => <Row key="push" icon="notifications-outline" label="Notify me about replies" hint="A notification when support answers" right={<Toggle value={pushOn} onChange={() => void togglePush()} />} last={last} />);

  return (
    <>
      <Card title="Help">
        {rows.map((r, i) => r(i === rows.length - 1))}
      </Card>
      {open === 'report' ? (
        <ReportIssueModal
          onClose={() => setOpen(null)}
          onSent={(id) => {
            setOpen(null);
            showSuccess(`Thanks. Your report ${id} was sent.`);
          }}
        />
      ) : null}
      {open === 'chat' || open === 'ask' ? <SupportInbox startNew={open === 'ask'} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
