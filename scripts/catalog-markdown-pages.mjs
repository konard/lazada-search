function validatePageSize(maximumLines) {
  if (
    !Number.isInteger(maximumLines) ||
    maximumLines < 4 ||
    maximumLines > 1200
  ) {
    throw new Error('Markdown page size must be between 4 and 1200 lines');
  }
}

function decoratePages(name, stem, pages) {
  for (const [index, page] of pages.entries()) {
    const previous = index > 0 ? ` · [Previous](${pages[index - 1].name})` : '';
    const next =
      index + 1 < pages.length ? ` · [Next](${pages[index + 1].name})` : '';
    page.text = `# ${stem}: page ${index + 1} of ${pages.length}\n\n[Index](${name})${previous}${next}\n\n${page.body}\n\n[Index](${name})${previous}${next}\n`;
    delete page.body;
  }
}

export function catalogMarkdownPages(name, text, maximumLines = 1000) {
  validatePageSize(maximumLines);
  const lines = text.trimEnd().split('\n');
  if (lines.length <= maximumLines) {
    return { index: `${text.trimEnd()}\n`, pages: [] };
  }
  const separator = (line) => /^\|[\s|:-]+$/u.test(line || '');
  const stem = name.replace(/\.md$/u, '');
  const pages = [];
  let offset = 0;
  let header;
  while (offset < lines.length) {
    let end = Math.min(offset + maximumLines, lines.length);
    if (end < lines.length && separator(lines[end])) {
      end -= 1;
    }
    const body = lines.slice(offset, end);
    const repeated =
      header && body[0]?.startsWith('|') && !separator(body[1])
        ? [...header, ...body]
        : body;
    for (let position = offset; position < end; position += 1) {
      if (lines[position].startsWith('|') && separator(lines[position + 1])) {
        header = lines.slice(position, position + 2);
      } else if (!lines[position].startsWith('|')) {
        header = undefined;
      }
    }
    pages.push({
      name: `${stem}-page-${String(pages.length + 1).padStart(3, '0')}.md`,
      body: repeated.join('\n'),
      sourceLineStart: offset + 1,
      sourceLineEnd: end,
    });
    offset = end;
  }
  const firstTable = lines.findIndex((line) => line.startsWith('|'));
  const intro = lines.slice(0, firstTable < 0 ? 1 : firstTable).join('\n');
  const navigation = pages
    .map(
      (page, index) =>
        `- [Page ${index + 1}](${page.name}) (original lines ${page.sourceLineStart}–${page.sourceLineEnd})`
    )
    .join('\n');
  decoratePages(name, stem, pages);
  return {
    index: `${intro.trimEnd()}\n\nAll ${lines.length} original report lines are retained across ${pages.length} bounded pages; repeated table headers do not add product records. The complete machine-readable inventory remains in [catalog.json](catalog.json).\n\n${navigation}\n`,
    pages,
  };
}
