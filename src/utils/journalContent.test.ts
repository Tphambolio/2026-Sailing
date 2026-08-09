import { describe, it, expect } from 'vitest';
import { parseContent, buildPhotoNumberMap, toShortForm, toFullForm, shortFormPhotoIds } from './journalContent';

describe('parseContent', () => {
  it('splits text and photo tokens into blocks in order', () => {
    const blocks = parseContent('Great walk.\n\n{{photo:abc-123}}\n\nSunset after.');
    expect(blocks).toEqual([
      { type: 'text', text: 'Great walk.\n\n' },
      { type: 'photo', id: 'abc-123' },
      { type: 'text', text: '\n\nSunset after.' },
    ]);
  });
});

describe('short-form photo tokens (editor display)', () => {
  it('numbers each distinct photo by order of first appearance', () => {
    const content = '{{photo:bbb}} text {{photo:aaa}} more {{photo:bbb}}';
    const map = buildPhotoNumberMap(content);
    expect(map.get('bbb')).toBe(1);
    expect(map.get('aaa')).toBe(2);
    expect(map.size).toBe(2); // bbb only counted once despite appearing twice
  });

  it('toShortForm replaces UUIDs with small numbers using the map', () => {
    const content = 'Before {{photo:bbb}} middle {{photo:aaa}} after';
    const map = buildPhotoNumberMap(content);
    expect(toShortForm(content, map)).toBe('Before {{photo 1}} middle {{photo 2}} after');
  });

  it('toFullForm is the exact inverse of toShortForm', () => {
    const content = 'Before {{photo:e118aa45-1ae6-433d-b38b-dbaf02726517}} after {{photo:6ce9f14a-b470-4619-b3c5-c6783b14ad3c}}';
    const map = buildPhotoNumberMap(content);
    const short = toShortForm(content, map);
    expect(toFullForm(short, map)).toBe(content);
  });

  it('toFullForm leaves an unmapped short token untouched rather than dropping it', () => {
    const map = new Map([['abc', 1]]);
    expect(toFullForm('see {{photo 1}} and {{photo 99}}', map)).toBe('see {{photo:abc}} and {{photo 99}}');
  });

  it('shortFormPhotoIds reverses short tokens back to the underlying photo IDs', () => {
    const map = new Map([['photo-abc', 1], ['photo-xyz', 2]]);
    const ids = shortFormPhotoIds('one {{photo 2}} two {{photo 1}}', map);
    expect(ids).toEqual(new Set(['photo-abc', 'photo-xyz']));
  });

  it('shortFormPhotoIds ignores a number with no mapping', () => {
    const map = new Map([['photo-abc', 1]]);
    const ids = shortFormPhotoIds('{{photo 1}} {{photo 5}}', map);
    expect(ids).toEqual(new Set(['photo-abc']));
  });
});
