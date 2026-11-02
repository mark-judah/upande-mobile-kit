import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setup } from '../helpers';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///f/', getInfoAsync: jest.fn() }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }), { virtual: true });

import { ForceUpdateGate } from '../../src/updates/ForceUpdateGate';

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

const click = (label: string) => {
  const el = Array.from(document.body.querySelectorAll('[role="button"], button')).find((e) => e.textContent?.includes(label));
  if (!el) throw new Error(`no "${label}" button`);
  act(() => (el as HTMLElement).click());
};

describe('ForceUpdateGate', () => {
  it('names the version and app, and offers only Install (no Later, no close)', () => {
    const onInstall = jest.fn();
    act(() => root.render(<ForceUpdateGate version="1.3.0" busy={false} error={null} onInstall={onInstall} />));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Update required');
    expect(text).toContain('Version 1.3.0 of Test App is ready');
    expect(text).not.toContain('Later');
    click('Install now');
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('shows the install error and the unknown-sources shortcut when installs are blocked', () => {
    act(() => root.render(<ForceUpdateGate version="1.3.0" busy={false} error={{ kind: 'blocked', message: 'Allow installs.' }} onInstall={() => {}} />));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Allow installs.');
    expect(text).toContain('Allow installs from this app');
  });

  it('disables the button while the installer is opening', () => {
    const onInstall = jest.fn();
    act(() => root.render(<ForceUpdateGate version="1.3.0" busy error={null} onInstall={onInstall} />));
    expect(document.body.textContent).toContain('Opening installer…');
    click('Opening installer');
    expect(onInstall).not.toHaveBeenCalled();
  });
});
