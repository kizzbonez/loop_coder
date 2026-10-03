import clsx from 'clsx';
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, ZoomIn, type LucideIcon } from 'lucide-react';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../../components/ui/misc';
import { guideImageUrl, headingSlug } from './guide-content';

type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const ALERTS: Record<AlertType, { label: string; icon: LucideIcon; className: string }> = {
  note: { label: 'Note', icon: Info, className: 'border-info/30 bg-info/8 [--alert:var(--info)]' },
  tip: { label: 'Tip', icon: Lightbulb, className: 'border-success/30 bg-success/8 [--alert:var(--success)]' },
  important: { label: 'Important', icon: CircleAlert, className: 'border-accent/35 bg-accent-soft [--alert:var(--accent)]' },
  warning: { label: 'Warning', icon: TriangleAlert, className: 'border-warning/35 bg-warning/8 [--alert:var(--warning)]' },
  caution: { label: 'Caution', icon: OctagonAlert, className: 'border-danger/35 bg-danger/8 [--alert:var(--danger)]' },
};

export function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : '',
    )
    .join('');
}

/** Detects GitHub alert syntax (`> [!TIP]`) and returns the alert type plus the children without the marker. */
function splitAlert(children: ReactNode): { type: AlertType | null; children: ReactNode[] } {
  const items = Children.toArray(children);
  const index = items.findIndex((c) => isValidElement(c));
  const first = items[index] as ReactElement<{ children?: ReactNode }> | undefined;
  if (!first) return { type: null, children: items };
  const inner = Children.toArray(first.props.children);
  const head = inner[0];
  const match = typeof head === 'string' ? /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(head) : null;
  if (!match || typeof head !== 'string') return { type: null, children: items };
  inner[0] = head.slice(match[0].length);
  const next = items.slice();
  next[index] = cloneElement(first, {}, ...inner);
  return { type: match[1]!.toLowerCase() as AlertType, children: next };
}

function Callout({ children }: { children?: ReactNode }) {
  const { type, children: content } = splitAlert(children);
  const alert = ALERTS[type ?? 'note'];
  const Icon = alert.icon;
  return (
    <aside className={clsx('guide-callout my-6 flex gap-3 rounded-xl border px-4 py-3.5', alert.className)}>
      <Icon className="mt-0.5 size-5 shrink-0 text-[var(--alert)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-xs font-semibold tracking-wider text-[var(--alert)] uppercase">{alert.label}</div>
        <div className="text-[14px] leading-relaxed text-fg [&_p]:m-0">{content}</div>
      </div>
    </aside>
  );
}

/** A screenshot in a browser-window frame with its caption; click to enlarge. */
function Screenshot({ src, alt, onZoom }: { src: string; alt: string; onZoom: (img: { src: string; alt: string }) => void }) {
  const narrow = /mobile/.test(src);
  const element = /card|column-header|agent-status/.test(src);
  return (
    <figure className={clsx('guide-figure my-8', narrow && 'mx-auto max-w-[340px]', element && 'mx-auto max-w-md')}>
      <button
        type="button"
        onClick={() => onZoom({ src, alt })}
        className="group block w-full cursor-zoom-in overflow-hidden rounded-xl border border-line-strong bg-surface text-left shadow-pop transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        aria-label={`Enlarge screenshot: ${alt}`}
      >
        {!element && (
          <span className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 h-4 flex-1 rounded-md bg-surface-3" />
          </span>
        )}
        <span className="relative block">
          <img src={src} alt={alt} loading="lazy" className="block w-full" />
          <span className="absolute top-3 right-3 flex items-center gap-1 rounded-lg bg-black/65 px-2 py-1 text-xs text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
            <ZoomIn className="size-3.5" /> Enlarge
          </span>
        </span>
      </button>
      {alt && <figcaption className="mt-2.5 text-center text-[13px] text-subtle">{alt}</figcaption>}
    </figure>
  );
}

export function GuideMarkdown({
  markdown,
  onZoom,
  onSectionLink,
}: {
  markdown: string;
  onZoom: (img: { src: string; alt: string }) => void;
  /** Called for in-guide links (`#slug`); return true if handled (e.g. navigated to another section). */
  onSectionLink: (slug: string) => boolean;
}) {
  const heading =
    (Tag: 'h2' | 'h3' | 'h4') =>
    ({ children }: { children?: ReactNode }) => (
      <Tag id={headingSlug(textOf(children))} className="scroll-mt-24">
        {children}
      </Tag>
    );

  return (
    <div className="guide">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h2: heading('h2'),
          h3: heading('h3'),
          h4: heading('h4'),
          blockquote: ({ children }) => <Callout>{children}</Callout>,
          // Images render as block figures, so unwrap paragraphs that only hold an image.
          p: ({ children }) => {
            const only = Children.toArray(children);
            if (only.length === 1 && isValidElement(only[0]) && (only[0].props as { src?: string }).src !== undefined) return <>{children}</>;
            return <p>{children}</p>;
          },
          img: ({ src, alt }) => {
            const url = guideImageUrl(typeof src === 'string' ? src : undefined);
            return url ? <Screenshot src={url} alt={alt ?? ''} onZoom={onZoom} /> : null;
          },
          pre: ({ children }) => {
            const code = isValidElement<{ children?: ReactNode }>(children) ? textOf(children.props.children) : textOf(children);
            return <CodeBlock code={code.replace(/\n$/, '')} className="my-5" />;
          },
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-xl border border-line shadow-card">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => {
            if (href?.startsWith('#')) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    const slug = href.slice(1);
                    e.preventDefault();
                    if (!onSectionLink(slug)) document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {children}
                </a>
              );
            }
            // Links to other repository documents only make sense on GitHub.
            if (href && !/^https?:\/\//.test(href)) return <span className="font-medium text-fg">{children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
