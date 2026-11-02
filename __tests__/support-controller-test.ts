import { setup } from './helpers';

const mockRemember = jest.fn(async () => {});
jest.mock('../src/support/screenshot', () => ({ rememberScreen: () => mockRemember(), recentScreen: () => null, forgetScreen: () => {}, isScreenshotSupported: () => true }));

import { onSupportRequest, openReportProblem, openSupportChat } from '../src/support/controller';
import { FAB_LONG_PRESS_MS, isLongPress } from '../src/ui/fab-logic';

beforeEach(() => {
  setup();
  mockRemember.mockClear();
});

describe('opening support from anywhere', () => {
  it('takes the screenshot first, then asks the host to open the report sheet', async () => {
    const order: string[] = [];
    mockRemember.mockImplementation(async () => void order.push('shot'));
    const off = onSupportRequest((s) => order.push(`open:${s}`));
    expect(await openReportProblem()).toBe(true);
    expect(order).toEqual(['shot', 'open:report']);
    off();
  });

  it('opens chat without a screenshot', () => {
    const seen: string[] = [];
    const off = onSupportRequest((s) => seen.push(s));
    expect(openSupportChat()).toBe(true);
    expect(seen).toEqual(['chat']);
    expect(mockRemember).not.toHaveBeenCalled();
    off();
  });

  it('can open straight into one conversation (a tapped notification)', () => {
    const seen: [string, string | undefined][] = [];
    const off = onSupportRequest((s, th) => seen.push([s, th]));
    expect(openSupportChat('ISS-2026-00214')).toBe(true);
    expect(seen).toEqual([['chat', 'ISS-2026-00214']]);
    off();
  });

  it('does nothing, and says so, when the kit is not mounted (no host listening)', async () => {
    expect(await openReportProblem()).toBe(false);
    expect(openSupportChat()).toBe(false);
    expect(mockRemember).not.toHaveBeenCalled();
  });

  it('respects the app turning a tool off', async () => {
    setup({ support: { report: false } });
    const seen: string[] = [];
    const off = onSupportRequest((s) => seen.push(s));
    expect(await openReportProblem()).toBe(false);
    expect(openSupportChat()).toBe(true);
    setup({ support: false });
    expect(openSupportChat()).toBe(false);
    expect(seen).toEqual(['chat']);
    off();
  });

  it('stops notifying a host that unsubscribed', async () => {
    const seen: string[] = [];
    const off = onSupportRequest((s) => seen.push(s));
    off();
    expect(await openReportProblem()).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('floating button long-press', () => {
  it('counts a press held at least 600 ms', () => {
    expect(FAB_LONG_PRESS_MS).toBe(600);
    expect(isLongPress(599)).toBe(false);
    expect(isLongPress(600)).toBe(true);
    expect(isLongPress(2000)).toBe(true);
  });
});
