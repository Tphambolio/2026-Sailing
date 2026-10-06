import { useState } from 'react';
import { variantUrl } from '../utils/imageResize';

interface StopImageProps {
  /** URL of the original upload */
  src: string;
  alt: string;
  /** Display dimensions, when known — lets the browser reserve the right space before load */
  width?: number | null;
  height?: number | null;
  /** srcset `sizes` hint: how wide this image renders on screen */
  sizes: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * A journal photo that lets the browser pick the smaller stored variant that's
 * sharp enough (w480 / w1000), and reserves its aspect ratio up front
 * so text doesn't jump as photos arrive. If a variant is missing (e.g. an upload
 * whose variant PUT failed), it falls back to the original once.
 */
export default function StopImage({ src, alt, width, height, sizes, className, loading = 'lazy' }: StopImageProps) {
  const [variantsFailed, setVariantsFailed] = useState(false);
  // In-page photos top out at the 1000px variant — already ~2.5 device pixels per
  // CSS pixel on a phone, so the original (lightbox only) would mostly be wasted bytes.
  const fullWidth = width ?? 1600;
  const srcSet = variantsFailed
    ? undefined
    : [
        `${variantUrl(src, 'w480')} ${Math.min(480, fullWidth)}w`,
        `${variantUrl(src, 'w1000')} ${Math.min(1000, fullWidth)}w`,
      ].join(', ');

  return (
    <img
      src={variantsFailed ? src : variantUrl(src, 'w1000')}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      width={width ?? undefined}
      height={height ?? undefined}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => { if (!variantsFailed) setVariantsFailed(true); }}
      className={className}
    />
  );
}
