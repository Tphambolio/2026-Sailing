import { describe, it, expect, vi, afterEach } from 'vitest';

// ffmpeg.wasm needs a real Worker + WASM runtime neither jsdom nor node
// provide, so the FFmpeg class itself is mocked — these tests verify the
// trim *logic* (duration math, the size-check loop, error propagation),
// not that ffmpeg-core actually decodes anything.
const { MockFFmpeg, loadMock, execMock, writeFileMock, readFileMock, deleteFileMock } = vi.hoisted(() => {
  const loadMock = vi.fn().mockResolvedValue(true);
  const execMock = vi.fn().mockResolvedValue(0);
  const writeFileMock = vi.fn().mockResolvedValue(true);
  const readFileMock = vi.fn();
  const deleteFileMock = vi.fn().mockResolvedValue(true);
  class MockFFmpeg {
    load = loadMock;
    exec = execMock;
    writeFile = writeFileMock;
    readFile = readFileMock;
    deleteFile = deleteFileMock;
  }
  return { MockFFmpeg, loadMock, execMock, writeFileMock, readFileMock, deleteFileMock };
});

vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: MockFFmpeg }));
vi.mock('@ffmpeg/util', () => ({
  toBlobURL: vi.fn().mockResolvedValue('blob:fake-url'),
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

// jsdom's <video> never actually loads real media, so metadata events never
// fire on their own — stub document.createElement('video') with a fake
// element whose duration and load/error events the test controls directly.
function stubVideoDuration(duration: number | null) {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'video') return realCreateElement(tag);
    const listeners: Record<string, () => void> = {};
    const fakeVideo = {
      duration,
      preload: '',
      set src(_v: string) {
        // Fire asynchronously, like a real media element would.
        queueMicrotask(() => listeners[duration === null ? 'error' : 'loadedmetadata']?.());
      },
      addEventListener: (event: string, cb: () => void) => { listeners[event] = cb; },
      removeEventListener: () => {},
    };
    return fakeVideo as unknown as HTMLVideoElement;
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:video'), revokeObjectURL: vi.fn() });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  loadMock.mockClear();
  execMock.mockClear();
  writeFileMock.mockClear();
  readFileMock.mockReset();
  deleteFileMock.mockClear();
});

describe('trimVideoToSizeLimit', () => {
  it('returns the file unchanged when already under the limit, without loading ffmpeg', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    const file = new File(['x'.repeat(100)], 'clip.mp4', { type: 'video/mp4' });

    const result = await trimVideoToSizeLimit(file, 1000);

    expect(result).toBe(file);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('trims an oversized clip down to fit, using -c copy and the file\'s original name/type', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(100); // 100s clip
    const maxBytes = 10_000_000;
    const file = new File(['x'.repeat(20_000_000)], 'clip.mov', { type: 'video/quicktime' });
    readFileMock.mockResolvedValueOnce(new Uint8Array(9_000_000)); // fits first try

    const result = await trimVideoToSizeLimit(file, maxBytes);

    expect(execMock).toHaveBeenCalledTimes(1);
    const args = execMock.mock.calls[0][0] as string[];
    expect(args).toEqual(['-i', 'input.mov', '-t', expect.any(String), '-c', 'copy', 'trimmed.mov']);
    // duration * (maxBytes/fileSize) * 0.92 margin = 100 * 0.5 * 0.92 = 46.00
    expect(args[3]).toBe('46.00');
    expect(result.name).toBe('clip.mov');
    expect(result.type).toBe('video/quicktime');
    expect(result.size).toBe(9_000_000);
    // Scratch files are cleaned up either way.
    expect(deleteFileMock).toHaveBeenCalledWith('input.mov');
  });

  it('retries with a tighter target if the first pass still overshoots the limit', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(100);
    const maxBytes = 10_000_000;
    const file = new File(['x'.repeat(20_000_000)], 'clip.mp4', { type: 'video/mp4' });
    readFileMock
      .mockResolvedValueOnce(new Uint8Array(12_000_000)) // still over on attempt 1
      .mockResolvedValueOnce(new Uint8Array(9_500_000)); // fits on attempt 2

    const result = await trimVideoToSizeLimit(file, maxBytes);

    expect(execMock).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(9_500_000);
    // The failed attempt's scratch output is cleaned up before retrying.
    expect(deleteFileMock).toHaveBeenCalledWith('trimmed.mp4');
  });

  it('throws instead of returning an oversized file after exhausting every attempt', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(100);
    const file = new File(['x'.repeat(20_000_000)], 'clip.mp4', { type: 'video/mp4' });
    readFileMock.mockResolvedValue(new Uint8Array(15_000_000)); // never fits

    await expect(trimVideoToSizeLimit(file, 10_000_000)).rejects.toThrow(/still over the limit/i);
    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it('propagates a non-zero ffmpeg exit code as an error rather than reading a bad output file', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(100);
    const file = new File(['x'.repeat(20_000_000)], 'clip.mp4', { type: 'video/mp4' });
    execMock.mockResolvedValueOnce(1);

    await expect(trimVideoToSizeLimit(file, 10_000_000)).rejects.toThrow(/exited with code 1/);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('rejects when the video duration cannot be read, without ever loading ffmpeg', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(null);
    const file = new File(['x'.repeat(20_000_000)], 'clip.mp4', { type: 'video/mp4' });

    await expect(trimVideoToSizeLimit(file, 10_000_000)).rejects.toThrow(/could not read video metadata/i);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('reuses one loaded ffmpeg instance across multiple trims instead of reloading the ~30MB core each time', async () => {
    const { trimVideoToSizeLimit } = await import('./videoTrim');
    stubVideoDuration(100);
    readFileMock.mockResolvedValue(new Uint8Array(9_000_000));

    await trimVideoToSizeLimit(new File(['x'.repeat(20_000_000)], 'a.mp4', { type: 'video/mp4' }), 10_000_000);
    await trimVideoToSizeLimit(new File(['x'.repeat(20_000_000)], 'b.mp4', { type: 'video/mp4' }), 10_000_000);

    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});
