import { useEffect, useState } from 'react';
import { ui } from '../ui/primitives';
import { SupportInbox } from './SupportInbox';
import { onSupportRequest, type SupportSheet } from './controller';
import { ReportIssueModal } from './ReportIssueModal';

/** Mounted once by `MobileKitProvider`: shows the report or chat sheet whenever `openReportProblem()` / `openSupportChat()` is called. */
export function SupportHost() {
  const [open, setOpen] = useState<SupportSheet | null>(null);
  const { useToast } = ui();
  const { showSuccess } = useToast();

  useEffect(() => onSupportRequest((sheet) => setOpen((cur) => cur ?? sheet)), []);

  if (open === 'report') {
    return (
      <ReportIssueModal
        onClose={() => setOpen(null)}
        onSent={(id) => {
          setOpen(null);
          showSuccess(`Thanks. Your report ${id} was sent.`);
        }}
      />
    );
  }
  return open === 'chat' ? <SupportInbox onClose={() => setOpen(null)} /> : null;
}
