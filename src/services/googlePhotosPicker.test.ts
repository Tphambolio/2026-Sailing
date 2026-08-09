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

describe('startGooglePhotosSession (unconfigured)', () => {
  it('rejects immediately when VITE_GOOGLE_CLIENT_ID is unset', async () => {
    const { isGooglePhotosConfigured, startGooglePhotosSession } = await import('./googlePhotosPicker');
    expect(isGooglePhotosConfigured).toBe(false);
    await expect(startGooglePhotosSession()).rejects.toThrow(/not configured/i);
  });
});

describe('googlePhotosPicker (configured)', () => {
  afterEach(() => {
    delete (window as { google?: unknown }).google;
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useRealTimers();
  });

  it('startGooglePhotosSession returns a handle with the picker URI, without opening anything itself', async () => {
    const { startGooglePhotosSession, isGooglePhotosConfigured } = await importConfigured();
    expect(isGooglePhotosConfigured).toBe(true);

    stubGis('fake-access-token');
    vi.stubGlobal('fetch', stubFetchFlow());
    const openSpy = vi.spyOn(window, 'open');

    const statuses: string[] = [];
    const handle = await startGooglePhotosSession((s) => statuses.push(s));

    expect(statuses).toEqual(['opening']);
    expect(handle.pickerUri).toBe('https://photos.google.com/picker/session-1');
    expect(handle.sessionId).toBe('session-1');
    expect(handle.token).toBe('fake-access-token');
    // The whole point of this design: no window.open() call anywhere in the flow.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('waitForGooglePhotosSelection polls until selection, then downloads the picked files', async () => {
    const { startGooglePhotosSession, waitForGooglePhotosSelection } = await importConfigured();
    stubGis('fake-access-token');
    vi.stubGlobal('fetch', stubFetchFlow());

    const handle = await startGooglePhotosSession();
    const statuses: string[] = [];
    const { files, failures } = await waitForGooglePhotosSelection(handle, (s) => statuses.push(s));

    expect(statuses).toEqual(['waiting', 'downloading']);
    expect(failures).toEqual([]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sunset.jpg');
    expect(files[0].type).toBe('image/jpeg');
  });

  it('downloads a READY video normally, alongside a photo picked in the same batch', async () => {
    const { startGooglePhotosSession, waitForGooglePhotosSelection } = await importConfigured();
    stubGis('fake-access-token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/v1/sessions') && method === 'POST') {
        return { ok: true, json: async () => ({ id: 's1', pickerUri: 'https://photos.google.com/picker/s1', mediaItemsSet: false, pollingConfig: { pollInterval: '0.01s', timeoutIn: '10s' } }) } as Response;
      }
      if (url.includes('/v1/sessions/s1') && method === 'GET') {
        return { ok: true, json: async () => ({ id: 's1', mediaItemsSet: true }) } as Response;
      }
      if (url.includes('/v1/mediaItems?') && method === 'GET') {
        return { ok: true, json: async () => ({ mediaItems: [
          { id: 'photo-1', type: 'PHOTO', mediaFile: { filename: 'sunset.jpg', mimeType: 'image/jpeg', baseUrl: 'https://photo-base/photo-1' } },
          { id: 'video-1', type: 'VIDEO', mediaFile: { filename: 'clip.mp4', mimeType: 'video/mp4', baseUrl: 'https://photo-base/video-1', mediaFileMetadata: { videoMetadata: { processingStatus: 'READY' } } } },
        ] }) } as Response;
      }
      if (url.startsWith('https://photo-base/photo-1')) return { ok: true, blob: async () => new Blob(['photo-bytes'], { type: 'image/jpeg' }) } as Response;
      if (url.startsWith('https://photo-base/video-1')) return { ok: true, blob: async () => new Blob(['video-bytes'], { type: 'video/mp4' }) } as Response;
      if (url.includes('/v1/sessions/s1') && method === 'DELETE') return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }));

    const handle = await startGooglePhotosSession();
    const { files, failures } = await waitForGooglePhotosSelection(handle);

    expect(failures).toEqual([]);
    expect(files.map(f => f.name).sort()).toEqual(['clip.mp4', 'sunset.jpg']);
  });

  it('reports a still-processing video as a failure without losing a photo picked in the same batch', async () => {
    // This is the exact bug reported live: picking a photo + a video that Google
    // hasn't finished processing yet used to fail the whole Promise.all and
    // silently drop the photo too, with a generic "Failed to fetch".
    const { startGooglePhotosSession, waitForGooglePhotosSelection } = await importConfigured();
    stubGis('fake-access-token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/v1/sessions') && method === 'POST') {
        return { ok: true, json: async () => ({ id: 's1', pickerUri: 'https://photos.google.com/picker/s1', mediaItemsSet: false, pollingConfig: { pollInterval: '0.01s', timeoutIn: '10s' } }) } as Response;
      }
      if (url.includes('/v1/sessions/s1') && method === 'GET') {
        return { ok: true, json: async () => ({ id: 's1', mediaItemsSet: true }) } as Response;
      }
      if (url.includes('/v1/mediaItems?') && method === 'GET') {
        return { ok: true, json: async () => ({ mediaItems: [
          { id: 'photo-1', type: 'PHOTO', mediaFile: { filename: 'sunset.jpg', mimeType: 'image/jpeg', baseUrl: 'https://photo-base/photo-1' } },
          { id: 'video-1', type: 'VIDEO', mediaFile: { filename: 'clip.mp4', mimeType: 'video/mp4', baseUrl: 'https://photo-base/video-1', mediaFileMetadata: { videoMetadata: { processingStatus: 'PROCESSING' } } } },
        ] }) } as Response;
      }
      if (url.startsWith('https://photo-base/photo-1')) return { ok: true, blob: async () => new Blob(['photo-bytes'], { type: 'image/jpeg' }) } as Response;
      // The video fetch should never even be attempted while still PROCESSING —
      // if it is, that's the bug this test exists to catch.
      if (url.startsWith('https://photo-base/video-1')) throw new Error('video fetch should not have been attempted');
      if (url.includes('/v1/sessions/s1') && method === 'DELETE') return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }));

    const handle = await startGooglePhotosSession();
    const { files, failures } = await waitForGooglePhotosSelection(handle);

    expect(files.map(f => f.name)).toEqual(['sunset.jpg']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/clip\.mp4.*still processing/i);
  });

  it('polls immediately when the tab becomes visible again, instead of waiting out a long throttled interval', async () => {
    const { startGooglePhotosSession, waitForGooglePhotosSelection } = await importConfigured();
    stubGis('fake-access-token');

    let pollCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.endsWith('/v1/sessions') && method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'session-1',
            pickerUri: 'https://photos.google.com/picker/session-1',
            mediaItemsSet: false,
            // A long interval — this is what Chrome's background-tab timer
            // throttling would otherwise force a real wait through.
            pollingConfig: { pollInterval: '60s', timeoutIn: '300s' },
          }),
        } as Response;
      }
      if (url.includes('/v1/sessions/session-1') && method === 'GET') {
        pollCount += 1;
        return { ok: true, json: async () => ({ id: 'session-1', mediaItemsSet: true }) } as Response;
      }
      if (url.includes('/v1/mediaItems?') && method === 'GET') {
        return { ok: true, json: async () => ({ mediaItems: [] }) } as Response;
      }
      if (url.includes('/v1/sessions/session-1') && method === 'DELETE') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }));

    const handle = await startGooglePhotosSession();

    vi.useFakeTimers();
    const resultPromise = waitForGooglePhotosSelection(handle);

    // Advance only 1 second — nowhere close to the 60s poll interval.
    await vi.advanceTimersByTimeAsync(1000);
    expect(pollCount).toBe(0);

    // Simulate switching back to this tab from the Google Photos tab.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    await resultPromise;
    expect(pollCount).toBe(1);
  });

  it('rejects instead of hanging forever if the OAuth pop-up is silently blocked (no callback ever fires)', async () => {
    const { startGooglePhotosSession } = await importConfigured();
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
    const assertion = expect(startGooglePhotosSession()).rejects.toThrow(/pop-up blocked/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
