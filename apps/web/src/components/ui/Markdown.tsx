import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders untrusted markdown (agent and user remarks) safely: raw HTML is not rendered
 * (no rehype-raw), and links open in a new tab without referrer or opener.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('prose-lc break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {c}
            </a>
          ),
          img: ({ alt }) => <span className="text-subtle">[image: {alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
