import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import StopImage from './StopImage';
import { variantUrl } from '../utils/imageResize';

describe('variantUrl', () => {
  it('points an image at its stored size variant', () => {
    expect(variantUrl('https://x.test/stop/1.jpg', 'w480')).toBe('https://x.test/stop/1.w480.jpg');
    expect(variantUrl('https://x.test/stop/1.PNG', 'w1000')).toBe('https://x.test/stop/1.w1000.jpg');
  });
  it('leaves non-images alone', () => {
    expect(variantUrl('https://x.test/stop/clip.mp4', 'w480')).toBe('https://x.test/stop/clip.mp4');
  });
});

describe('StopImage', () => {
  it('offers all sizes via srcset and reserves the aspect ratio from known dimensions', () => {
    const { container } = render(<StopImage src="https://x.test/s/1.jpg" alt="" width={1200} height={1600} sizes="100vw" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('srcset')).toBe('https://x.test/s/1.w480.jpg 480w, https://x.test/s/1.w1000.jpg 1000w');
    expect(img).toHaveAttribute('width', '1200');
    expect(img).toHaveAttribute('height', '1600');
  });

  it('falls back to the original once if a variant is missing', () => {
    const { container } = render(<StopImage src="https://x.test/s/1.jpg" alt="" sizes="100vw" />);
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', 'https://x.test/s/1.jpg');
    expect(img).not.toHaveAttribute('srcset');
  });
});
