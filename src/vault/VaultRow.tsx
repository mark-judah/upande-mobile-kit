import { useEffect, useState } from 'react';
import { getConfig } from '../config';
import { Row, Toggle, ui } from '../ui/primitives';
import { clearVault, enrolVault, isVaultEnrolled, isVaultSupported } from './index';
import { VaultPasswordModal } from './VaultPasswordModal';

/** The Settings switch for `biometric: 'vault'`: keeps the sign-in behind the fingerprint, or forgets it. */
export function VaultRow() {
  const cfg = getConfig();
  const auth = cfg.useAuth();
  const { useToast } = ui();
  const { showSuccess, showError } = useToast();
  const [supported] = useState(() => isVaultSupported());
  const [on, setOn] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    isVaultEnrolled().then(setOn);
  }, []);

  const turnOff = async () => {
    await clearVault();
    await auth.setBiometricEnabled(false).catch(() => {});
    setOn(false);
    showSuccess('Fingerprint sign-in turned off.');
  };

  const enrol = async (password: string): Promise<string | null> => {
    if (!auth.user) return 'Sign in first.';
    const ok = await enrolVault({ server: auth.instanceUrl ?? cfg.site ?? '', user: auth.user, password });
    if (!ok) return 'Fingerprint was not confirmed. Nothing was saved.';
    await auth.setBiometricEnabled(true).catch(() => {});
    setOn(true);
    setAsking(false);
    showSuccess('Fingerprint sign-in is on.');
    return null;
  };

  const toggle = () => {
    if (!supported) {
      showError('This build cannot keep a sign-in behind the fingerprint. Update the app to a build that includes expo-secure-store.');
      return;
    }
    if (on) void turnOff();
    else setAsking(true);
  };

  return (
    <>
      <Row
        icon="finger-print-outline"
        label="Fingerprint sign-in"
        hint={supported ? 'Skip the password with your fingerprint or face' : 'Needs a newer build of the app'}
        right={<Toggle value={on} onChange={toggle} />}
        last
      />
      {asking ? <VaultPasswordModal user={auth.user ?? ''} onSubmit={enrol} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
