import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ functions: { invoke: mockInvoke } }),
}));

import { uploadStopPhoto } from './supabase';

describe('uploadStopPhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockInvoke.mockReset();
  });

  const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

  it('returns an error instead of throwing when the R2 PUT is blocked (CORS / network)', async () => {
    mockInvoke.mockResolvedValue({ data: { uploadUrl: 'https://r2.test/put', path: 'stop/1.jpg' }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await uploadStopPhoto(file, 'stop');

    expect(result.path).toBe('');
    expect(result.error?.message).toMatch(/R2 upload failed: Failed to fetch/);
  });

  it('returns an error for a non-OK R2 response', async () => {
    mockInvoke.mockResolvedValue({ data: { uploadUrl: 'https://r2.test/put', path: 'stop/1.jpg' }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    const result = await uploadStopPhoto(file, 'stop');

    expect(result.error?.message).toBe('R2 upload failed: 403');
  });

  it('returns the storage path on success', async () => {
    mockInvoke.mockResolvedValue({ data: { uploadUrl: 'https://r2.test/put', path: 'stop/1.jpg' }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const result = await uploadStopPhoto(file, 'stop');

    expect(result).toEqual({ path: 'stop/1.jpg', error: null });
  });
});

describe('uploadStopPhoto size variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); mockInvoke.mockReset(); });
  const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

  it('requests and PUTs the variants it was given, and a failed variant never fails the upload', async () => {
    mockInvoke.mockResolvedValue({
      data: { uploadUrl: 'https://r2.test/put', path: 'stop/1.jpg', variantUploadUrls: { w480: 'https://r2.test/v480', w1000: 'https://r2.test/v1000' } },
      error: null,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://r2.test/v1000') throw new TypeError('Failed to fetch');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadStopPhoto(file, 'stop', { w480: new Blob(['a']), w1000: new Blob(['b']) });

    expect(mockInvoke).toHaveBeenCalledWith('get-upload-url', { body: { stopKey: 'stop', filename: 'photo.jpg', variants: ['w480', 'w1000'] } });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['https://r2.test/put', 'https://r2.test/v480', 'https://r2.test/v1000']));
    expect(result).toEqual({ path: 'stop/1.jpg', error: null });
  });
});
