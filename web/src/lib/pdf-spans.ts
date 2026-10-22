import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';
import type { SourceRect, SourceSpan } from '../../../shared/types';

const bounded = (value: number) => Math.max(0, Math.min(1, value));
type ExtractedLine = { text: string; rects: SourceRect[]; y: number; height: number; left: number; fontSize: number };

/** Geometry comes from native PDF text, never from a model. Rectangles are line regions. */
export function nativeLines(items: TextItem[], styles: Record<string, TextStyle>, viewport: { transform: number[]; width: number; height: number; scale: number }): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  let current: ExtractedLine | undefined;
  let previousRight = 0;
  for (const item of items) {
    if (!item.str.trim()) { if (item.hasEOL) current = undefined; continue; }
    const a = viewport.transform;
    const b = item.transform;
    // Compose the glyph transform with PDF.js's page-to-canvas transform.
    const transform = [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const style = styles[item.fontName];
    const ascent = style?.ascent ?? (style?.descent ? 1 + style.descent : .85);
    const x = transform[4];
    const y = transform[5] - fontHeight * ascent;
    const width = Math.abs(item.width * viewport.scale);
    const height = fontHeight;
    // Rotated/vertical individual glyph runs have no safely inferred line box.
    const horizontal = Math.abs(transform[1]) < .01 && transform[0] > 0 && !style?.vertical;
    const rect = horizontal && width > 0 && height > 0 ? {
      x: bounded(x / viewport.width), y: bounded(y / viewport.height),
      width: bounded(Math.min(width, viewport.width - Math.max(0, x)) / viewport.width),
      height: bounded(Math.min(height, viewport.height - Math.max(0, y)) / viewport.height),
    } : undefined;
    // A large horizontal gap may be a second column or table cell, not a word gap.
    const sameLine = current && Math.abs(current.y - y) < Math.max(height, current.height) * .45 && x >= current.left - 2 && x - previousRight < Math.max(height, current.height) * 3.5;
    if (!sameLine) {
      current = { text: item.str, rects: rect ? [rect] : [], y, height, left: x, fontSize: fontHeight };
      lines.push(current);
    } else if (current) {
      const needsSpace = x - previousRight > fontHeight * .12 && !current.text.endsWith(' ') && !item.str.startsWith(' ');
      current.text += `${needsSpace ? ' ' : ''}${item.str}`;
      if (rect) current.rects.push(rect);
      current.height = Math.max(current.height, height);
    }
    previousRight = x + width;
    if (item.hasEOL) current = undefined;
  }
  return lines.map(line => {
    // Merge the adjacent glyph runs into an honest enclosing line highlight.
    if (line.rects.length > 1) {
      const minX = Math.min(...line.rects.map(r => r.x));
      const minY = Math.min(...line.rects.map(r => r.y));
      line.rects = [{ x: minX, y: minY, width: Math.max(...line.rects.map(r => r.x + r.width)) - minX, height: Math.max(...line.rects.map(r => r.y + r.height)) - minY }];
    }
    return line;
  });
}

export function spansFromLines(lines: ExtractedLine[], documentId: string, pageIndex: number): SourceSpan[] {
  const groups: ExtractedLine[][] = [];
  for (const line of lines) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const hasBreak = !previous || Math.abs(line.y - previous.y) > previous.height * 1.85 || Math.abs(line.left - previous.left) > 90 || line.fontSize > previous.fontSize * 1.2 || previous.fontSize > line.fontSize * 1.2 || current!.reduce((n, l) => n + l.text.length, 0) > 1300;
    if (hasBreak) groups.push([line]); else current!.push(line);
  }
  return groups.map((group, index) => ({
    id: `${documentId}-p${pageIndex}-s${index}`,
    documentId, pageIndex,
    text: group.map(line => line.text).join('\n').trim(),
    rects: group.flatMap(line => line.rects),
    quality: group.every(line => line.rects.length) ? 'native-text; line-level location; formulas may need visual checking' : 'native-text; partial location; check the original page',
    kind: group.length === 1 && group[0].text.length < 100 ? 'heading' : 'paragraph',
  }));
}

