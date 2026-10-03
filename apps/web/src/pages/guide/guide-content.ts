// The user guide is the same file as docs/USER_GUIDE.md, bundled at build time so the
// in-app copy always matches the documentation shipped with this version.
import guideMarkdown from '../../../../../docs/USER_GUIDE.md?raw';

const imageModules = import.meta.glob('../../../../../docs/images/guide/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Screenshot file name (e.g. "12-board.png") → bundled asset URL. */
export const GUIDE_IMAGES = new Map(Object.entries(imageModules).map(([path, url]) => [path.split('/').pop()!, url]));

export const GUIDE_MARKDOWN = guideMarkdown;

/** GitHub-compatible heading anchors, so links like `#6-connecting-your-ai-agent` keep working. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** Rough markdown → plain text, for descriptions and search. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?\[![A-Z]+\]\s*$/gm, ' ')
    .replace(/\*\*|[*`]/g, '')
    .replace(/[>#|]/g, ' ')
    .replace(/^-{3,}$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface GuideSection {
  number: number;
  /** Title without its number, e.g. "Connecting your AI agent". */
  title: string;
  /** Route and anchor slug, e.g. "6-connecting-your-ai-agent". */
  slug: string;
  /** Section markdown without its "## " heading. */
  body: string;
  /** First paragraph, as plain text. */
  description: string;
  text: string;
}

export interface ParsedGuide {
  title: string;
  /** Paragraphs between the title and the first section (without images). */
  intro: string;
  sections: GuideSection[];
}

function firstParagraph(body: string): string {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(!\[|>|\||```|-{3}|<|#)/.test(p) && !/^([-*+]\s|\d+\.\s)/.test(p));
  let text = plainText(paragraph ?? '');
  // "…in this order:" introduces a list; keep the sentences before it.
  if (text.endsWith(':')) text = text.replace(/\s*[^.!?]*:$/, '') || text.replace(/:$/, '.');
  return text.length > 150 ? `${text.slice(0, 147).replace(/\s+\S*$/, '')}…` : text;
}

export function parseGuide(markdown: string): ParsedGuide {
  const [head = '', ...chunks] = markdown.split(/^## /m);
  const title = /^# (.+)$/m.exec(head)?.[1]?.trim() ?? 'User guide';
  const intro = head
    .replace(/^# .+$/m, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^-{3,}\s*$/gm, '')
    .trim();
  const sections = chunks
    .map((chunk) => {
      const newline = chunk.indexOf('\n');
      const heading = chunk.slice(0, newline).trim();
      const body = chunk.slice(newline + 1).replace(/\n-{3,}\s*$/m, '').trim();
      const match = /^(\d+)\.\s*(.+)$/.exec(heading);
      return { heading, body, match };
    })
    .filter((c) => c.match) // skips "Contents"
    .map(({ heading, body, match }) => ({
      number: Number(match![1]),
      title: match![2]!.trim(),
      slug: headingSlug(heading),
      body,
      description: firstParagraph(body),
      text: plainText(body),
    }));
  return { title, intro, sections };
}

export const GUIDE = parseGuide(GUIDE_MARKDOWN);

export interface SearchResult {
  section: GuideSection;
  /** Text around the first match, with the match itself split out for highlighting. */
  snippet: { before: string; match: string; after: string } | null;
}

export function searchGuide(query: string, sections: GuideSection[] = GUIDE.sections): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections.map((section) => ({ section, snippet: null }));
  const results: Array<SearchResult & { score: number }> = [];
  for (const section of sections) {
    const inTitle = section.title.toLowerCase().includes(q);
    const at = section.text.toLowerCase().indexOf(q);
    if (!inTitle && at === -1) continue;
    const snippet =
      at === -1
        ? null
        : {
            before: (at > 60 ? '…' : '') + section.text.slice(Math.max(0, at - 60), at),
            match: section.text.slice(at, at + q.length),
            after: section.text.slice(at + q.length, at + q.length + 80) + '…',
          };
    results.push({ section, snippet, score: inTitle ? 0 : 1 });
  }
  return results.sort((a, b) => a.score - b.score || a.section.number - b.section.number);
}

/**
 * Resolve an in-guide anchor (`#6-connecting-your-ai-agent`, `#step-1-create-a-project-token`)
 * to the section page that holds it, plus the sub-heading to scroll to.
 */
export function resolveAnchor(anchor: string, sections: GuideSection[] = GUIDE.sections): { section: GuideSection; hash?: string } | undefined {
  const direct = sections.find((s) => s.slug === anchor);
  if (direct) return { section: direct };
  const owner = sections.find((s) => [...s.body.matchAll(/^#{3,4} (.+)$/gm)].some((m) => headingSlug(m[1]!) === anchor));
  return owner ? { section: owner, hash: anchor } : undefined;
}

/** Resolve a markdown image path such as `images/guide/12-board.png` to its bundled URL. */
export function guideImageUrl(src: string | undefined): string | undefined {
  if (!src) return undefined;
  return GUIDE_IMAGES.get(src.split('/').pop() ?? '');
}
