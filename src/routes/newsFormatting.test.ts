import { describe, expect, it } from 'bun:test';
import { formatNewsExcerpt, getNewsImage } from './newsFormatting';

describe('news formatting', () => {
  it('prefers enclosure and media content images before the fallback', () => {
    expect(
      getNewsImage(
        { enclosure: { url: 'https://example.com/enclosure.jpg' } },
        'fallback'
      )
    ).toBe('https://example.com/enclosure.jpg');
    expect(
      getNewsImage(
        { mediaContent: { $: { url: 'https://example.com/media.jpg' } } },
        'fallback'
      )
    ).toBe('https://example.com/media.jpg');
    expect(getNewsImage({}, 'fallback')).toBe('fallback');
  });

  it('strips markup and caps the excerpt before adding its ellipsis', () => {
    expect(formatNewsExcerpt('<b>Smoke</b> over <i>forest</i>')).toBe(
      'Smoke over forest...'
    );
    expect(formatNewsExcerpt('x'.repeat(200))).toBe(`${'x'.repeat(150)}...`);
  });
});
