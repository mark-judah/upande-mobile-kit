import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_SETTINGS_ROUTE, getConfig, type KitTheme } from '../config';
import {
  fetchInstalls,
  mergeInstallRows,
  parseServerTime,
  type InstallRow,
  type InstallsReply,
  type InstallStatus,
} from '../devices/devices-api';
import { getInstallId, getRegisteredRowId } from '../devices/install-register';
import { registerKitScreen } from '../route-guard';
import { Segmented, spacing, fontSize, ui, useTheme } from '../ui/primitives';

/**
 * The device register: each device running this app, the build it runs, every
 * account that has used it (each on its own last version) and what the server
 * says it should update to. System Managers only.
 * A row's status and "update to" are the server's; nothing is worked out here.
 *
 * Timestamps come in the site's timezone without an offset, so "x ago" is
 * measured against the same response's `server_time`, not the phone's clock.
 */

const PAGE_SIZE = 30;
/** The server's cap; a search reads this many and filters them here. */
const SEARCH_SIZE = 500;

type Window = '0' | '7' | '30';

const statusStyles = (t: KitTheme): Record<InstallStatus, { label: string; fg: string; bg: string }> => ({
  current: { label: 'Current', fg: '#166534', bg: '#DCFCE7' },
  behind_ota: { label: 'Behind', fg: '#92400E', bg: '#FEF3C7' },
  needs_apk: { label: 'Needs APK', fg: '#991B1B', bg: '#FEE2E2' },
  ahead: { label: 'Ahead', fg: '#1E40AF', bg: '#DBEAFE' },
  dormant: { label: 'Dormant', fg: t.textSecondary, bg: t.surfaceAlt },
  unknown: { label: 'Unknown', fg: t.textSecondary, bg: t.surfaceAlt },
});

function ago(ts: string | null | undefined, serverNow: string | null | undefined): string {
  const t = parseServerTime(ts);
  const now = parseServerTime(serverNow) ?? Date.now();
  if (t == null) return '—';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days}d ago` : (ts ?? '').slice(0, 10);
}

function matches(r: InstallRow, q: string): boolean {
  const hay = [
    r.full_name,
    r.user,
    r.device_name,
    r.device_brand,
    r.device_model,
    r.os_version,
    r.app_version,
    r.ip_address,
    r.app,
    ...(r.users ?? []).flatMap((u) => [u.full_name, u.user, u.app_version]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

/** The Devices page. Anyone but a System Manager is sent back to Settings. */
export function DevicesScreen() {
  const cfg = getConfig();
  useEffect(() => registerKitScreen('devices'), []);
  const { isSystemManager } = cfg.useAuth();
  return isSystemManager ? <DevicesRegister /> : <Redirect href={(cfg.settingsRoute ?? DEFAULT_SETTINGS_ROUTE) as never} />;
}

function DevicesRegister() {
  const cfg = getConfig();
  const { Screen, Card, Button } = ui();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const { instanceUrl } = cfg.useAuth();
  const [days, setDays] = useState<Window>('0');
  const [dormant, setDormant] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const [data, setData] = useState<InstallsReply | null>(null);
  const [rows, setRows] = useState<InstallRow[]>([]);
  // Rows read from the server so far (the next page's start); `rows` can be
  // fewer once an install that moved between pages is counted once.
  const [fetched, setFetched] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myInstallId, setMyInstallId] = useState<string | null>(null);
  const [myRowId, setMyRowId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    getInstallId().then(setMyInstallId).catch(() => {});
    getRegisteredRowId(instanceUrl).then(setMyRowId).catch(() => {});
  }, [instanceUrl]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const key = `${days}|${dormant ? 1 : 0}|${query ? 'q' : ''}`;

  const load = useCallback(
    async (more: boolean) => {
      const mine = ++seq.current;
      if (more) setLoadingMore(true);
      try {
        const res = await fetchInstalls({
          app: cfg.appName,
          since_days: Number(days) || undefined,
          include_dormant: dormant,
          start: more ? fetched : 0,
          page_length: query ? SEARCH_SIZE : PAGE_SIZE,
        });
        if (mine !== seq.current) return;
        setData(res);
        setRows((prev) => mergeInstallRows(more ? prev : [], res.rows));
        setFetched((prev) => (more ? prev : 0) + res.rows.length);
        setError(null);
      } catch (err) {
        if (mine !== seq.current) return;
        setError(cfg.errorMessage ? cfg.errorMessage(err) : err instanceof Error ? err.message : 'Could not load devices.');
      } finally {
        if (mine === seq.current) {
          setSettledKey(key);
          setLoadingMore(false);
        }
      }
    },
    [days, dormant, query, fetched, key, cfg],
  );

  // From the top whenever a filter changes (`load` also changes with `fetched`).
  useEffect(() => {
    const t = setTimeout(() => load(false), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = settledKey !== key;
  const shown = query ? rows.filter((r) => matches(r, query)) : rows;
  const hasMore = !query && fetched < (data?.total ?? 0);
  // Searching filters here, so the count is what is shown.
  const count = query ? shown.length : (data?.total ?? 0);
  const byStatus = data?.by_status ?? {};

  return (
    <Screen
      title="Devices"
      loading={loading && !data}
      error={!data ? error : null}
      onRetry={() => load(false)}
      onRefresh={() => load(false)}
    >
      <Card>
        <Segmented<Window>
          value={days}
          onChange={setDays}
          options={[
            { value: '0', label: 'All' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
          ]}
        />
        <View style={s.searchRow}>
          <View style={s.searchBox}>
            <Ionicons name="search" size={16} color={t.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="User, device or version"
              placeholderTextColor={t.textMuted}
              style={s.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={t.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={() => setDormant((d) => !d)} style={[s.chip, dormant && s.chipOn]}>
            <Text style={[s.chipText, dormant && s.chipTextOn]}>Dormant</Text>
          </Pressable>
        </View>
        {data ? (
          <View style={s.counts}>
            {(Object.keys(statusStyles(t)) as InstallStatus[])
              .filter((st) => byStatus[st])
              .map((st) => (
                <StatusBadge key={st} status={st} count={byStatus[st]} />
              ))}
          </View>
        ) : null}
      </Card>

      <Card title={data ? `${count} ${count === 1 ? 'device' : 'devices'}` : 'Devices'}>
        {error && data ? <Text style={s.errorText}>{error}</Text> : null}
        {!shown.length && !loading ? <Text style={s.empty}>No devices</Text> : null}
        {shown.map((r) => (
          <DeviceRow key={r.install_id} row={r} serverNow={data?.server_time} mine={r.install_id === myInstallId || r.install_id === myRowId} />
        ))}
        {hasMore ? (
          <Button
            label={`Show more (${fetched} of ${data?.total ?? 0})`}
            variant="ghost"
            onPress={() => load(true)}
            loading={loadingMore}
            style={s.more}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

function StatusBadge({ status, count }: { status: InstallStatus; count?: number }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const st = statusStyles(t)[status] ?? statusStyles(t).unknown;
  return (
    <View style={[s.badge, { backgroundColor: st.bg }]}>
      <Text style={[s.badgeText, { color: st.fg }]}>
        {st.label}
        {count != null ? ` ${count}` : ''}
      </Text>
    </View>
  );
}

function DeviceRow({ row, serverNow, mine }: { row: InstallRow; serverNow?: string; mine: boolean }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [open, setOpen] = useState(false);
  const model = [row.device_brand, row.device_model].filter(Boolean).join(' ') || 'Unknown device';
  const name = row.device_name && row.device_name !== row.device_model ? row.device_name : model;
  const os = `${row.platform ?? ''} ${row.os_version ?? ''}`.trim();
  const users = row.users ?? [];
  const userCount = row.user_count ?? users.length;
  const lastUser = row.full_name || row.user || 'No user';
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
      <Ionicons
        name={row.is_physical_device ? 'phone-portrait-outline' : 'desktop-outline'}
        size={20}
        color={t.textSecondary}
      />
      <View style={s.flex}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {name}
          {mine ? '  (this device)' : ''}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {os ? `${os} · ` : ''}
          {row.app} {row.app_version || '?'} · {ago(row.last_seen, serverNow)}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {lastUser}
          {userCount > 1 ? ` · ${userCount} users` : ''}
        </Text>
        {row.update_to ? (
          <Text style={s.updateTo} numberOfLines={2}>
            Update to {row.update_to}
          </Text>
        ) : null}
        {open ? (
          <View style={s.details}>
            {users.map((u) => (
              <View key={u.user} style={s.detailRow}>
                <Text style={s.userName} numberOfLines={1}>
                  {u.full_name || u.user}
                </Text>
                <Text style={s.userVersion} numberOfLines={1}>
                  {u.app_version || '?'} · {ago(u.last_seen, serverNow)}
                </Text>
              </View>
            ))}
            {users.length ? <View style={s.gap} /> : null}
            <Detail label="Model" value={model} />
            <Detail label="OS" value={os || '—'} />
            {row.previous_app_version ? (
              <Detail
                label="Upgraded"
                value={`${row.previous_app_version} → ${row.app_version} · ${ago(row.version_changed_at, serverNow)}`}
              />
            ) : null}
            <Detail label="Sign-ins" value={String(row.logins)} />
            <Detail label="Launches" value={String(row.launches)} />
            <Detail label="First seen" value={(row.first_seen ?? '—').slice(0, 16)} />
            <Detail label="IP" value={row.ip_address || '—'} />
            <Detail label="Install ID" value={row.install_id.slice(0, 8)} />
          </View>
        ) : null}
      </View>
      <StatusBadge status={row.status} />
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = (t: KitTheme) =>
  StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchInput: { flex: 1, fontFamily: (t.fontRegular || undefined), fontSize: fontSize.md, color: t.text, padding: 0 },
  chip: {
    paddingHorizontal: spacing.md,
    height: 40,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
  },
  chipOn: { backgroundColor: t.text, borderColor: t.text },
  chipText: { fontFamily: (t.fontMedium || undefined), fontSize: fontSize.sm, color: t.textSecondary },
  chipTextOn: { color: t.textOnPrimary },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
  },
  rowTitle: { fontFamily: (t.fontSemiBold || undefined), fontSize: fontSize.sm, color: t.text },
  rowMeta: { fontFamily: (t.fontRegular || undefined), fontSize: fontSize.xs, color: t.textMuted, marginTop: 2 },
  updateTo: { fontFamily: (t.fontMedium || undefined), fontSize: fontSize.xs, color: t.text, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontFamily: (t.fontMedium || undefined), fontSize: fontSize.xs },
  details: { marginTop: spacing.sm, gap: 2 },
  detailRow: { flexDirection: 'row', gap: spacing.sm },
  detailLabel: { width: 80, fontFamily: (t.fontRegular || undefined), fontSize: fontSize.xs, color: t.textMuted },
  detailValue: { flex: 1, fontFamily: (t.fontMedium || undefined), fontSize: fontSize.xs, color: t.textSecondary },
  userName: { flex: 1, fontFamily: (t.fontMedium || undefined), fontSize: fontSize.xs, color: t.text },
  userVersion: { fontFamily: (t.fontRegular || undefined), fontSize: fontSize.xs, color: t.textSecondary },
  empty: {
    fontFamily: (t.fontRegular || undefined),
    fontSize: fontSize.sm,
    color: t.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  errorText: { fontFamily: (t.fontRegular || undefined), fontSize: fontSize.sm, color: t.danger, marginBottom: spacing.sm },
  more: { marginTop: spacing.sm },
});
