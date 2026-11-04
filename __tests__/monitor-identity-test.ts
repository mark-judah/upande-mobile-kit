import { cleanBuildNumber, cleanIp, cleanMac, cleanSerial } from '../src/monitor/identity';

describe('device identifiers', () => {
  it('keeps a real MAC address, upper-cased with colons', () => {
    expect(cleanMac('a4:5e:60:c2:11:9f')).toBe('A4:5E:60:C2:11:9F');
    expect(cleanMac('A4-5E-60-C2-11-9F')).toBe('A4:5E:60:C2:11:9F');
  });
  it('drops the placeholders Android and iOS return instead of a MAC address', () => {
    expect(cleanMac('02:00:00:00:00:00')).toBeUndefined();
    expect(cleanMac('00:00:00:00:00:00')).toBeUndefined();
    expect(cleanMac('unknown')).toBeUndefined();
    expect(cleanMac(null)).toBeUndefined();
  });
  it('keeps a real serial and drops the stand-ins', () => {
    expect(cleanSerial(' R58M123ABC ')).toBe('R58M123ABC');
    for (const bad of ['unknown', 'UNKNOWN', '0', 'null', '', '<script>', undefined, 5]) expect(cleanSerial(bad as never)).toBeUndefined();
  });
  it('reads IPv4 and IPv6 and rejects "none"', () => {
    expect(cleanIp('10.78.203.154')).toBe('10.78.203.154');
    expect(cleanIp('FE80::1')).toBe('fe80::1');
    expect(cleanIp('0.0.0.0')).toBeUndefined();
    expect(cleanIp('::')).toBeUndefined();
    expect(cleanIp('999.1.1.1')).toBeUndefined();
    expect(cleanIp('not an ip')).toBeUndefined();
  });
  it('reads a build number from text or a number', () => {
    expect(cleanBuildNumber('105100')).toBe('105100');
    expect(cleanBuildNumber(52)).toBe('52');
    expect(cleanBuildNumber('<x>')).toBeUndefined();
    expect(cleanBuildNumber(null)).toBeUndefined();
  });
});
