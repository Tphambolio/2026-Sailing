// Google Photos Picker API integration — lets the user browse and select
// photos/videos directly from their Google Photos library on any platform
// (not just Android, where the OS-level picker already offers it).
//
// Flow: get an OAuth access token via Google Identity Services (no client
// secret needed — this is the browser/SPA token flow), create a picker
// session, open Google's own hosted picker UI in a new tab, poll until the
// user finishes selecting, then download the picked items as File objects
// ready to feed into the app's existing upload pipeline.
//
// Requires a Google Cloud OAuth Client ID in VITE_GOOGLE_CLIENT_ID. The
// exported isGooglePhotosConfigured flag lets callers hide the feature
// entirely until that's set up — see README for the Cloud Console steps.

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const PICKER_API_BASE = 'https://photospicker.googleapis.com/v1';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export const isGooglePhotosConfigured = !!GOOGLE_CLIENT_ID;

export type GooglePickerStatus = 'opening' | 'waiting' | 'downloading';

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleAccountsOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
  }): { requestAccessToken: () => void };
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOAuth2 } };
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

// Call this well before any click handler needs it (e.g. on mount). Chrome's
// popup blocker only allows a popup opened synchronously-ish within a user
// gesture's task; awaiting the GIS <script> network fetch inside the click
// handler burns that window, so requestAccessToken() below silently fails to
// open anything and hangs forever (no error callback fires). Preloading means
// the fast path (script already present) is what actually runs on click.
export function preloadGoogleIdentityServices(): void {
  loadGisScript().catch(() => {
    // Ignore — requestAccessToken will surface this properly if it's still
    // failing by the time the user actually clicks.
  });
}

function requestAccessToken(): Promise<string> {
  return loadGisScript().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const oauth2 = window.google?.accounts?.oauth2;
        if (!oauth2) { reject(new Error('Google Identity Services did not load')); return; }

        // GIS gives no callback at all if the popup itself is blocked, so
        // without this the whole flow hangs silently forever instead of
        // surfacing a fixable error.
        const timeout = setTimeout(() => {
          reject(new Error('Pop-up blocked — allow pop-ups for this site, then try again.'));
        }, 60_000);

        const client = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: PICKER_SCOPE,
          callback: (resp) => {
            clearTimeout(timeout);
            if (resp.error || !resp.access_token) reject(new Error(resp.error || 'No access token returned'));
            else resolve(resp.access_token);
          },
        });
        client.requestAccessToken();
      })
  );
}

interface PickerSession {
  id: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

interface PickedMediaFile {
  filename: string;
  mimeType: string;
  baseUrl: string;
}

interface PickedMediaItem {
  id: string;
  type: 'PHOTO' | 'VIDEO' | string;
  mediaFile: PickedMediaFile;
}

async function apiCall<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PICKER_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Photos Picker API error (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

// Google returns durations like "5s" — a plain seconds-with-suffix string.
function parseDurationSeconds(d: string | undefined, fallback: number): number {
  if (!d) return fallback;
  const n = parseFloat(d.replace(/s$/, ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function listPickedMediaItems(token: string, sessionId: string): Promise<PickedMediaItem[]> {
  const items: PickedMediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const qp = new URLSearchParams({ sessionId, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const data = await apiCall<{ mediaItems?: PickedMediaItem[]; nextPageToken?: string }>(`/mediaItems?${qp}`, token);
    items.push(...(data.mediaItems || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

async function downloadPickedFile(token: string, item: PickedMediaItem): Promise<File> {
  // Google's baseUrl download-size suffix convention: =d for photos, =dv for video.
  const suffix = item.type === 'VIDEO' ? '=dv' : '=d';
  const res = await fetch(`${item.mediaFile.baseUrl}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to download ${item.mediaFile.filename}: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], item.mediaFile.filename, { type: item.mediaFile.mimeType || blob.type });
}

/**
 * Full flow: authorize, open Google's hosted picker, wait for the user to
 * finish selecting, and return the picked items as File objects.
 *
 * `pickerWindow` must be opened synchronously by the caller, in the same
 * click handler, before calling this — via window.open('', '_blank') — and
 * passed in here. Chrome's pop-up blocker only allows window.open() within
 * a fresh user-gesture task; everything below this point involves awaited
 * network calls (the OAuth token exchange, creating the picker session), so
 * opening the picker's real URL as a *new* window at that point gets
 * silently blocked. Navigating an *already-open* window via
 * `.location.href`, on the other hand, doesn't need fresh activation, which
 * is why the caller opens a blank one upfront and we just redirect it here.
 */
export async function pickFromGooglePhotos(
  pickerWindow: Window | null,
  onStatusChange?: (status: GooglePickerStatus) => void
): Promise<File[]> {
  if (!pickerWindow || pickerWindow.closed) {
    throw new Error('Pop-up blocked — allow pop-ups for this site, then try again.');
  }
  if (!isGooglePhotosConfigured) {
    pickerWindow.close();
    throw new Error('Google Photos is not configured (missing VITE_GOOGLE_CLIENT_ID)');
  }

  try {
    onStatusChange?.('opening');
    const token = await requestAccessToken();
    const session = await apiCall<PickerSession>('/sessions', token, { method: 'POST', body: '{}' });

    pickerWindow.location.href = session.pickerUri;

    onStatusChange?.('waiting');
    const pollIntervalMs = parseDurationSeconds(session.pollingConfig?.pollInterval, 3) * 1000;
    const timeoutMs = parseDurationSeconds(session.pollingConfig?.timeoutIn, 300) * 1000;
    const deadline = Date.now() + timeoutMs;

    let current = session;
    while (!current.mediaItemsSet) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for a Google Photos selection.');
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      current = await apiCall<PickerSession>(`/sessions/${session.id}`, token);
    }

    onStatusChange?.('downloading');
    const items = await listPickedMediaItems(token, session.id);
    const files = await Promise.all(items.map((item) => downloadPickedFile(token, item)));

    // Best-effort cleanup — sessions auto-expire on their own, so a failure here isn't worth surfacing.
    apiCall(`/sessions/${session.id}`, token, { method: 'DELETE' }).catch(() => {});

    return files;
  } catch (err) {
    // Don't leave a blank/abandoned tab hanging around on any failure path.
    if (!pickerWindow.closed) pickerWindow.close();
    throw err;
  }
}
