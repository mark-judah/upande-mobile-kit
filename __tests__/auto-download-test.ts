import { runAutoDownload, shouldPromptInstall } from '../src/updates/auto-download';

const deps = (o: Partial<Parameters<typeof runAutoDownload>[0]> & { calls?: string[] } = {}) => {
  const calls: string[] = o.calls ?? [];
  return {
    calls,
    deps: {
      onDisk: async () => false,
      mode: async () => 'wifi' as const,
      network: async () => 'wifi' as const,
      download: async () => void calls.push('download'),
      ...o,
    },
  };
};

describe('runAutoDownload', () => {
  it('downloads on Wi-Fi in the default mode', async () => {
    const { deps: d, calls } = deps();
    expect(await runAutoDownload(d)).toBe('downloaded');
    expect(calls).toEqual(['download']);
  });

  it('does nothing on mobile data or an unknown network in Wi-Fi mode', async () => {
    for (const net of ['cellular', 'unknown', 'none'] as const) {
      const { deps: d, calls } = deps({ network: async () => net });
      expect(await runAutoDownload(d)).toBe('skipped');
      expect(calls).toEqual([]);
    }
  });

  it("downloads on any connection when the mode is 'always', but never offline", async () => {
    expect(await runAutoDownload(deps({ mode: async () => 'always', network: async () => 'cellular' }).deps)).toBe('downloaded');
    expect(await runAutoDownload(deps({ mode: async () => 'always', network: async () => 'none' }).deps)).toBe('skipped');
  });

  it("never downloads when the mode is 'never'", async () => {
    const { deps: d, calls } = deps({ mode: async () => 'never' });
    expect(await runAutoDownload(d)).toBe('skipped');
    expect(calls).toEqual([]);
  });

  it('leaves a file already on disk to the prompt, whatever the mode or network, without re-downloading', async () => {
    const { deps: d, calls } = deps({ onDisk: async () => true, mode: async () => 'never', network: async () => 'none' });
    expect(await runAutoDownload(d)).toBe('on-disk');
    expect(calls).toEqual([]);
  });
});

describe('shouldPromptInstall', () => {
  const base = {
    availableVersion: '1.3.0',
    downloadedVersion: '1.3.0',
    manual: false,
    promptedVersion: null,
    dismissedVersion: null,
    canInstallInApp: true,
  };
  it('prompts for a finished background download', () => expect(shouldPromptInstall(base)).toBe(true));
  it.each([
    ['not downloaded', { downloadedVersion: null }],
    ['a different version downloaded', { downloadedVersion: '1.2.0' }],
    ['no update available', { availableVersion: null }],
    ['the person drove the download', { manual: true }],
    ['already prompted this run', { promptedVersion: '1.3.0' }],
    ['dismissed with Later', { dismissedVersion: '1.3.0' }],
    ['no in-app installer', { canInstallInApp: false }],
  ])('does not prompt: %s', (_n, patch) => expect(shouldPromptInstall({ ...base, ...patch })).toBe(false));
  it('prompts again for a NEWER version after Later', () =>
    expect(shouldPromptInstall({ ...base, availableVersion: '1.4.0', downloadedVersion: '1.4.0', dismissedVersion: '1.3.0' })).toBe(true));
});
