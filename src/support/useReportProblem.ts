import { getConfig } from '../config';
import { openReportProblem, openSupportChat } from './controller';
import { supportOptions } from './options';

/** For custom triggers: `const { reportProblem } = useReportProblem()`, then call it from a header icon, a shake handler, anywhere. */
export function useReportProblem() {
  const opts = supportOptions(getConfig().support);
  return { reportProblem: openReportProblem, openChat: openSupportChat, reportAvailable: opts.report, chatAvailable: opts.chat };
}
