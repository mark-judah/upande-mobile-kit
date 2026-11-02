import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setup } from '../helpers';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///f/', getInfoAsync: jest.fn() }));
jest.mock('../../src/support/screenshot', () => ({ rememberScreen: async () => {}, recentScreen: () => null, forgetScreen: () => {}, isScreenshotSupported: () => false }));
jest.mock('../../src/monitor/device', () => ({ collectDeviceFacts: async () => ({}), appBuildFacts: () => ({ app_version: '1.0.0' }), peekDeviceFacts: () => ({}), readStaticFacts: () => ({}) }));
const mockThreads = jest.fn(async () => ({ mode: 'chat', threads: [] as unknown[] }));
jest.mock('../../src/support/support-api', () => ({
  submitReport: jest.fn(),
  fetchChat: async () => ({ messages: [], unread: 0 }),
  fetchUnread: async () => 0,
  sendChat: jest.fn(),
  mergeMessages: (a: unknown[], b: unknown[]) => [...a, ...b],
  fetchThreads: () => mockThreads(),
  fetchThread: jest.fn(async () => ({ thread: { id: 'ISS-1', subject: 'Wrong length', status: 'Open' }, messages: [] })),
  replyThread: jest.fn(),
  loadSeen: async () => ({}),
  markSeen: async () => {},
  unreadThreads: (t: { id: string; last_staff_at: string | null }[]) => t.filter((x) => x.last_staff_at).map((x) => x.id),
}));

import { openReportProblem, openSupportChat } from '../../src/support/controller';
import { SupportHost } from '../../src/support/SupportHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  setup();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SupportHost', () => {
  it('shows nothing until asked, then the report sheet from any screen', async () => {
    act(() => root.render(<SupportHost />));
    expect(document.body.textContent).not.toContain('Report a problem');
    await act(async () => {
      await openReportProblem();
    });
    expect(document.body.textContent).toContain('Report a problem');
    expect(document.body.textContent).toContain('Subject');
  });

  it('on a site with Issues the chat is the list of the person’s conversations, with unread marked and a way to start one', async () => {
    mockThreads.mockResolvedValueOnce({ mode: 'issue', threads: [{ id: 'ISS-1', subject: 'Wrong length', status: 'Open', last_activity: 't', last_staff_at: 't', preview: 'Which bucket?' }] });
    act(() => root.render(<SupportHost />));
    await act(async () => {
      openSupportChat();
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Chat with support');
    expect(text).toContain('Wrong length');
    expect(text).toContain('Which bucket?');
    expect(text).toContain('New message');
  });

  it('opens the chat sheet, and ignores a second request while one is open', async () => {
    act(() => root.render(<SupportHost />));
    await act(async () => {
      openSupportChat();
    });
    expect(document.body.textContent).toContain('Chat with support');
    await act(async () => {
      await openReportProblem();
    });
    expect(document.body.textContent).toContain('Chat with support');
    expect(document.body.textContent).not.toContain('Subject');
  });
});
