import { describe, it, expect, vi, afterEach } from 'vitest';

// isGooglePhotosConfigured / the client ID are read from import.meta.env at
// module load time, so tests that need it "configured" have to stub the env
// var and re-import a fresh module instance — a plain re-import would reuse
// whatever was cached from the first (unconfigured) import in this file.
async function importConfigured() {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
  vi.resetModules();
  return import('./googlePhotosPicker');
}

// A minimal stand-in for the blank window the caller opens synchronously
// before calling pickFromGooglePhotos — just enough for the code under test
// to check `.closed` and assign `.location.href`.
function fakeWindow(): Window {
  return { closed: false, location: { href: '' }, close: vi.fn() } as unknown as Window;
}

function stubGis(accessToken: string) {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => ({
          requestAccessToken: () => config.callback({ access_token: accessToken }),
        }),
      },
    },
  };
}

function stubFetchFlow() {
  let pollCount = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';

    if (url.endsWith('/v1/sessions') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'session-1',
          pickerUri: 'https://photos.google.com/picker/session-1',
          mediaItemsSet: false,
          pollingConfig: { pollInterval: '0.01s', timeoutIn: '10s' },
        }),
      } as Response;
    }
    if (url.includes('/v1/sessions/session-1') && method === 'GET') {
      pollCount += 1;
      return {
        ok: true,
        json: async () => ({ id: 'session-1', mediaItemsSet: pollCount >= 2 }),
      } as Response;
    }
    if (url.includes('/v1/mediaItems?') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          mediaItems: [
            { id: 'item-1', type: 'PHOTO', mediaFile: { filename: 'sunset.jpg', mimeType: 'image/jpeg', baseUrl: 'https://photo-base/item-1' } },
          ],
        }),
      } as Response;
    }
    if (url.startsWith('https://photo-base/item-1')) {
      return { ok: true, blob: async () => new Blob(['fake-bytes'], { type: 'image/jpeg' }) } as Response;
    }
    if (url.includes('/v1/sessions/session-1') && method === 'DELETE') {
      return { ok: true, json: async () => ({}) } as Response;
    }
    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  });
}

describe('googlePhotosPicker (unconfigured)', () => {
  it('reports not configured and rejects immediately when VITE_GOOGLE_CLIENT_ID is unset', async () => {
    const { isGooglePhotosConfigured, pickFromGooglePhotos } = await import('./googlePhotosPicker');
    expect(isGooglePhotosConfigured).toBe(false);
    await expect(pickFromGooglePhotos(fakeWindow())).rejects.toThrow(/not configured/i);
  });
});

describe('googlePhotosPicker (configured)', () => {
  afterEach(() => {
    delete (window as { google?: unknown }).google;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  it('runs the full session -> poll -> list -> download flow and returns Files', async () => {
    const { pickFromGooglePhotos, isGooglePhotosConfigured } = await importConfigured();
    expect(isGooglePhotosConfigured).toBe(true);

    stubGis('fake-access-token');
    vi.stubGlobal('fetch', stubFetchFlow());
    const pickerWindow = fakeWindow();

    const statuses: string[] = [];
    const files = await pickFromGooglePhotos(pickerWindow, (s) => statuses.push(s));

    expect(statuses).toEqual(['opening', 'waiting', 'downloading']);
    expect(pickerWindow.location.href).toBe('https://photos.google.com/picker/session-1');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sunset.jpg');
    expect(files[0].type).toBe('image/jpeg');
  });

  it('throws a clear error when the caller could not open the picker tab (blocked by the browser)', async () => {
    const { pickFromGooglePhotos } = await importConfigured();

    // The caller is responsible for the synchronous window.open() call — this
    // is what it looks like when the browser blocked it, before we even get here.
    await expect(pickFromGooglePhotos(null)).rejects.toThrow(/pop-up blocked/i);
  });

  it('rejects instead of hanging forever if the OAuth pop-up is silently blocked (no callback ever fires)', async () => {
    const { pickFromGooglePhotos } = await importConfigured();
    // GIS gives no error or callback at all when its own pop-up is blocked —
    // simulate that by never invoking the client's callback.
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: () => ({ requestAccessToken: () => {} }),
        },
      },
    };

    vi.useFakeTimers();
    // Attach the assertion (which internally handles the rejection) before
    // advancing the clock, so the rejection is never briefly "unhandled".
    const assertion = expect(pickFromGooglePhotos(fakeWindow())).rejects.toThrow(/pop-up blocked/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
