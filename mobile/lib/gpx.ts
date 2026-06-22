// GPX import — the frictionless path for the ~68% of runners who record on
// Strava/Garmin and won't switch apps. A picked (or shared-in) .gpx goes through
// the SAME recorded-run pipeline as a live GPS run, so it credits challenges,
// leaderboards, and badges. Shared by the import screen, the "Your runs" entry,
// and the OS share-sheet handler.

import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";

import { useAuth } from "./auth";
import { importGPX, type Activity } from "./activities";

export function useGpxImport() {
  const { getAccessToken } = useAuth();
  const [importing, setImporting] = useState(false);

  // importFromUri uploads a .gpx already on disk (a picker cache file://, or a
  // file:// / content:// shared into the app). The backend parses it, de-dupes
  // by start time, and records it. Returns the activity, or null if no session.
  //
  // NOTE: a content:// uri from the share sheet is uploaded directly — fine for
  // our flow (the import fires immediately on open, while the OS grant is live).
  // When the share-intake EAS build lands, harden flaky-grant cases by copying
  // content:// → a cache file:// first (expo-file-system) — a native dep, so it
  // belongs in that build, not an OTA.
  const importFromUri = useCallback(
    async (uri: string, name = "run.gpx"): Promise<Activity | null> => {
      setImporting(true);
      try {
        const token = await getAccessToken();
        if (!token) return null;
        return await importGPX(token, uri, name);
      } finally {
        setImporting(false);
      }
    },
    [getAccessToken]
  );

  // pickAndImport opens the file picker, validates the extension, and imports.
  const pickAndImport = useCallback(async (): Promise<Activity | null> => {
    const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    if (!a.name?.toLowerCase().endsWith(".gpx")) {
      Alert.alert("Not a GPX file", "Pick a .gpx file exported from Strava, Garmin, or your watch.");
      return null;
    }
    return importFromUri(a.uri, a.name);
  }, [importFromUri]);

  return { importing, pickAndImport, importFromUri };
}
