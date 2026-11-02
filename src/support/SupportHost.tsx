import { useEffect, useState } from 'react';
import { ui } from '../ui/primitives';
import { offerReplyNotifications } from '../push';
import { SupportInbox } from './SupportInbox';
import { onSupportRequest, type SupportSheet } from './controller';
import { ReportIssueModal } from './ReportIssueModal';

/** Mounted once by `MobileKitProvider`: shows the report or chat sheet whenever `openReportProblem()` / `openSupportChat()` is called. */
export function SupportHost() {
  const [open, setOpen] = useState<SupportSheet | null>(null);
  const [thread, setThread] = useState<string | undefined>(undefined);
  const { useToast, showDialog } = ui();
  const { showSuccess } = useToast();

  useEffect(
    () =>
      onSupportRequest((sheet, th) => {
        setOpen((cur) => cur ?? sheet);
        setThread(th);
      }),
    [],
  );

  if (open === 'report') {
    return (
      <ReportIssueModal
        onClose={() => setOpen(null)}
        onSent={(id) => {
          setOpen(null);
          showSuccess(`Thanks. Your report ${id} was sent.`);
          void offerReplyNotifications(showDialog);
        }}
      />
    );
  }
  return open === 'chat' ? <SupportInbox initialThread={thread} onClose={() => setOpen(null)} /> : null;
}
