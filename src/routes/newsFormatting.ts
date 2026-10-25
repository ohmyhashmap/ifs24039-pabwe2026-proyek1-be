type NewsItem = {
  contentSnippet?: string;
  enclosure?: { url?: string };
  mediaContent?: { $?: { url?: string } };
};

export function getNewsImage(item: NewsItem, fallback: string): string {
  return item.enclosure?.url || item.mediaContent?.$?.url || fallback;
}

export function formatNewsExcerpt(contentSnippet?: string): string {
  const plainText: string[] = [];
  let pendingTag: string[] | undefined;

  for (const character of contentSnippet || '') {
    if (pendingTag) {
      if (character === '>') pendingTag = undefined;
      else pendingTag.push(character);
    } else if (character === '<') {
      pendingTag = ['<'];
    } else {
      plainText.push(character);
    }
  }

  if (pendingTag) plainText.push(pendingTag.join(''));
  return `${plainText.join('').substring(0, 150)}...`;
}
