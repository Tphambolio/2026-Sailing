import { describe, it, expect, vi, afterEach } from 'vitest';
import { downsampleImage } from './imageResize';

// jsdom implements neither createImageBitmap nor real canvas rasterization,
// so the decode/draw/encode pipeline is stubbed to verify the resize *logic*
// (scale math, skip conditions, fallbacks) rather than actual pixels.
function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }));
  return close;
}

function stubCanvas() {
  const drawImage = vi.fn();
  const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['resized'], { type: 'image/jpeg' })));
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob,
  };
  const realCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return fakeCanvas as unknown as HTMLCanvasElement;
    return realCreateElement(tag);
  });
  return { fakeCanvas, drawImage, createElementSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downsampleImage', () => {
  it('scales an oversized photo down to fit within the max dimension', async () => {
    stubBitmap(4000, 3000);
    const { fakeCanvas, drawImage } = stubCanvas();
    const original = new File(['x'.repeat(2_000_000)], 'photo.jpg', { type: 'image/jpeg' });

    const result = await downsampleImage(original);

    // 4000x3000 scaled to fit within 2048 -> 2048x1536, aspect ratio preserved.
    expect(fakeCanvas.width).toBe(2048);
    expect(fakeCanvas.height).toBe(1536);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(result).not.toBe(original);
  });

  it('leaves an already screen-sized, small photo untouched', async () => {
    const close = stubBitmap(1200, 800);
    const { createElementSpy } = stubCanvas();
    const original = new File(['x'.repeat(500_000)], 'small.jpg', { type: 'image/jpeg' });

    const result = await downsampleImage(original);

    expect(result).toBe(original);
    expect(createElementSpy).not.toHaveBeenCalledWith('canvas');
    expect(close).toHaveBeenCalled();
  });

  it('passes video files through unchanged, without attempting to decode them', async () => {
    const createImageBitmapSpy = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapSpy);
    const original = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    const result = await downsampleImage(original);

    expect(result).toBe(original);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
  });

  it('falls back to the original file if the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Unsupported image type')));
    const original = new File(['x'], 'photo.heic', { type: 'image/heic' });

    const result = await downsampleImage(original);

    expect(result).toBe(original);
  });

  it('still downsamples a large-dimension photo even under the byte-size skip threshold', async () => {
    // Guards against a bug where only file.size is checked and the dimension
    // check is skipped (e.g. a highly-compressed but very wide panorama).
    stubBitmap(5000, 1000);
    const { fakeCanvas } = stubCanvas();
    const original = new File(['x'.repeat(100_000)], 'pano.jpg', { type: 'image/jpeg' });

    const result = await downsampleImage(original);

    expect(fakeCanvas.width).toBe(2048);
    expect(result).not.toBe(original);
  });
});
