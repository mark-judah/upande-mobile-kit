import { apiMock, setup } from './helpers';
import { fetchInstalls, mergeInstallRows, parseServerTime, type InstallRow } from '../src/devices/devices-api';

beforeEach(() => setup());

const row = (id: string, v: string) => ({ install_id: id, app_version: v }) as InstallRow;

describe('fetchInstalls', () => {
  it('queries the configured installs endpoint with only the filters given', async () => {
    apiMock.mockResolvedValue({ message: { rows: [], total: 0 } });
    await fetchInstalls({ app: 'Test App', since_days: 7, include_dormant: true, start: 30, page_length: 30 });
    expect(apiMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/method/upande_mobile.api.installs',
      params: { app: 'Test App', since_days: 7, include_dormant: 1, start: 30, page_length: 30 },
    });
  });
  it('rejects a malformed reply', async () => {
    apiMock.mockResolvedValue({ message: {} });
    await expect(fetchInstalls({})).rejects.toThrow(/Unexpected response/);
  });
});

describe('parseServerTime', () => {
  it('reads site time, with or without microseconds', () => {
    expect(parseServerTime('2026-10-31 12:00:00')).not.toBeNull();
    expect(parseServerTime('2026-10-31 12:00:00.123456')).not.toBeNull();
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime('garbage')).toBeNull();
  });
});

describe('mergeInstallRows', () => {
  it('keeps one row per install, first place, newest data', () => {
    const out = mergeInstallRows([row('a', '1'), row('b', '1')], [row('b', '2'), row('c', '1')]);
    expect(out.map((r) => r.install_id)).toEqual(['a', 'b', 'c']);
    expect(out[1].app_version).toBe('2');
  });
});
