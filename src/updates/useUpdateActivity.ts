import * as Updates from 'expo-updates';
import { useApkUpdate } from './UpdateProvider';
import { activityOf, type UpdateActivity } from '../ui/ring-logic';

/** What is being downloaded right now: an APK (with progress), a JS update, or nothing. */
export function useUpdateActivity(): UpdateActivity {
  const { downloading, progress } = useApkUpdate();
  let otaDownloading = false;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- expo-updates' own hook; stable for the life of the app
    otaDownloading = !!Updates.useUpdates().isDownloading;
  } catch {
    otaDownloading = false;
  }
  return activityOf({ apkDownloading: downloading, apkFraction: progress?.fraction, otaDownloading });
}
