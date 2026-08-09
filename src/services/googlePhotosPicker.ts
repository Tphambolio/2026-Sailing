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

// Carries what waitForGooglePhotosSelection needs after the session is
// created — the access token has to be threaded through since it's not
// re-derivable from the session id alone.
export interface GooglePhotosSessionHandle {
  token: string;
  sessionId: string;
  pickerUri: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

interface PickedMediaFile {
  filename: string;
  mimeType: string;
  baseUrl: string;
  // Only present for videos. Google's docs are explicit: don't use the =dv
  // download suffix until this is READY — Google Photos processes uploaded
  // video before it's downloadable, and downloading too early fails with an
  // opaque "Failed to fetch" (observed live: a 1-second clip picked seconds
  // after being selected failed every time; the API never surfaces a clearer
  // error for this case, so downloadPickedFile checks it up front instead).
  mediaFileMetadata?: {
    videoMetadata?: { processingStatus?: 'UNSPECIFIED' | 'PROCESSING' | 'READY' | 'FAILED' };
  };
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
  if (item.type === 'VIDEO') {
    const status = item.mediaFile.mediaFileMetadata?.videoMetadata?.processingStatus;
    if (status !== 'READY') {
      throw new Error(
        `"${item.mediaFile.filename}" is still processing in Google Photos (status: ${status || 'unknown'}) — ` +
        `wait a minute and try again, or use "Add video" to upload it directly instead.`
      );
    }
  }

  // Google's baseUrl download-size suffix convention. =d pulls the full-resolution
  // original — for a phone photo that's routinely 5-10MB, which is what made
  // Google Photos imports take minutes (multi-MB download here, then another
  // multi-MB upload to Supabase) — live-tested end to end, a single =d original
  // (7MB) took over 4 minutes to just download on a real connection. =w1600-h1600
  // asks Google to scale it down to fit within a 1600x1600 box server-side
  // instead (aspect ratio preserved, no crop) — matches what downsampleImage()
  // targets for the follow-up Supabase upload, so both legs of the trip move a
  // fraction of the data. Video has no equivalent scaled-download option, so it
  // still uses =dv.
  const suffix = item.type === 'VIDEO' ? '=dv' : '=w1600-h1600';
  let res: Response;
  try {
    res = await fetch(`${item.mediaFile.baseUrl}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // fetch() rejects with an opaque "Failed to fetch" for network/CORS failures,
    // giving no detail — at least name which file it was.
    throw new Error(`Couldn't download "${item.mediaFile.filename}" from Google Photos (network error).`);
  }
  if (!res.ok) throw new Error(`Failed to download "${item.mediaFile.filename}": ${res.status}`);
  const blob = await res.blob();
  return new File([blob], item.mediaFile.filename, { type: item.mediaFile.mimeType || blob.type });
}

/**
 * Phase 1: authorize and create a picker session. Returns everything needed
 * to both open the picker (the caller renders a real <a href target="_blank">
 * with pickerUri — that's the point of returning it rather than opening a
 * window here) and later poll for the result.
 *
 * Deliberately does NOT call window.open()/location.href anywhere. Every
 * script-triggered way of opening a window — even one opened synchronously
 * in the same click handler via window.open('', '_blank') — turned out to
 * still get blocked by Chrome in practice for this flow. A native <a target=
 * "_blank"> element that the user directly clicks is the one thing browsers
 * reliably don't block, so the caller has to render an actual link instead
 * of this function opening anything itself.
 */
export async function startGooglePhotosSession(
  onStatusChange?: (status: GooglePickerStatus) => void
): Promise<GooglePhotosSessionHandle> {
  if (!isGooglePhotosConfigured) {
    throw new Error('Google Photos is not configured (missing VITE_GOOGLE_CLIENT_ID)');
  }
  onStatusChange?.('opening');
  const token = await requestAccessToken();
  const session = await apiCall<PickerSession>('/sessions', token, { method: 'POST', body: '{}' });
  return { token, sessionId: session.id, pickerUri: session.pickerUri, pollingConfig: session.pollingConfig };
}

// Resolves on whichever comes first: the poll interval elapsing, or the tab
// becoming visible again. Plain setTimeout alone is a bad fit here — the
// user's natural flow is to switch to the Google Photos tab to pick, which
// backgrounds this one, and Chrome throttles timers in background tabs
// heavily (observed: a session that finished in seconds on Google's side
// wasn't picked up here for minutes, because the tab was backgrounded the
// whole time). Reacting to visibilitychange means the next poll fires
// immediately on switching back, instead of waiting on a throttled timer.
function waitForNextPollOrVisible(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') finish();
    };
    const timer = setTimeout(finish, ms);
    document.addEventListener('visibilitychange', onVisible);
  });
}

export interface GooglePhotosSelectionResult {
  files: File[];
  // One item failing (e.g. a video still processing) used to fail the whole
  // Promise.all and silently discard every other item the user picked,
  // including ones that downloaded fine — live-tested, this was the actual
  // cause behind "I picked a photo and a video and the import failed" with
  // no trace of the photo. Reporting failures per-item alongside the files
  // that DID succeed keeps a good item from being held hostage by a bad one.
  failures: string[];
}

/**
 * Phase 2: called from the onClick of the <a> that opens the picker (so it's
 * still within that click's task, though nothing here needs a pop-up —
 * that's the whole point). Polls until the user finishes selecting in the
 * picker tab, then downloads what they picked as File objects.
 */
export async function waitForGooglePhotosSelection(
  handle: GooglePhotosSessionHandle,
  onStatusChange?: (status: GooglePickerStatus) => void
): Promise<GooglePhotosSelectionResult> {
  onStatusChange?.('waiting');
  const pollIntervalMs = parseDurationSeconds(handle.pollingConfig?.pollInterval, 3) * 1000;
  const timeoutMs = parseDurationSeconds(handle.pollingConfig?.timeoutIn, 300) * 1000;
  const deadline = Date.now() + timeoutMs;

  let mediaItemsSet = false;
  while (!mediaItemsSet) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a Google Photos selection.');
    await waitForNextPollOrVisible(pollIntervalMs);
    const current = await apiCall<PickerSession>(`/sessions/${handle.sessionId}`, handle.token);
    mediaItemsSet = current.mediaItemsSet;
  }

  onStatusChange?.('downloading');
  const items = await listPickedMediaItems(handle.token, handle.sessionId);
  const settled = await Promise.allSettled(items.map((item) => downloadPickedFile(handle.token, item)));

  const files: File[] = [];
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') files.push(result.value);
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  // Best-effort cleanup — sessions auto-expire on their own, so a failure here isn't worth surfacing.
  apiCall(`/sessions/${handle.sessionId}`, handle.token, { method: 'DELETE' }).catch(() => {});

  return { files, failures };
}
