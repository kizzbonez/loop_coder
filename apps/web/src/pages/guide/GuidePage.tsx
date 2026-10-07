import clsx from 'clsx';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Building,
  ChevronRight,
  FolderPlus,
  Gamepad2,
  KeyRound,
  LifeBuoy,
  Lightbulb,
  ListTodo,
  LogIn,
  MessageSquare,
  Moon,
  Plug,
  Rocket,
  Search,
  Settings,
  Shield,
  SquareKanban,
  Target,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Modal } from '../../components/ui/Modal';
import { useConfig } from '../../lib/queries';
import { GUIDE, guideImageUrl, resolveAnchor, resolveSlug, searchGuide, type GuideSection } from './guide-content';
import { GuideMarkdown } from './GuideMarkdown';

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/key ideas/i, Lightbulb],
  [/setup/i, Rocket],
  [/signing in/i, LogIn],
  [/workspace/i, Building],
  [/creating a project/i, FolderPlus],
  [/connecting/i, Plug],
  [/agent does/i, Bot],
  [/the board/i, SquareKanban],
  [/flow view/i, Workflow],
  [/agent office/i, Gamepad2],
  [/work item|answering/i, MessageSquare],
  [/backlog/i, ListTodo],
  [/sprint/i, Target],
  [/activity|files/i, Activity],
  [/project settings/i, Settings],
  [/account|token/i, KeyRound],
  [/administration/i, Shield],
  [/dark|mobile/i, Moon],
  [/troubleshooting|faq/i, LifeBuoy],
];

const iconFor = (s: GuideSection): LucideIcon => ICONS.find(([re]) => re.test(s.title))?.[1] ?? BookOpen;
const findSection = (re: RegExp) => GUIDE.sections.find((s) => re.test(s.title));

const START_HERE: Array<{ section?: GuideSection; title: string; text: string }> = [
  { section: findSection(/setup/i), title: 'Set up Loop Coder', text: 'Run the setup wizard and create your first workspace.' },
  { section: findSection(/connecting/i), title: 'Connect your AI agent', text: 'Claude Code, Cursor, VS Code or any other MCP client.' },
  { section: findSection(/the board/i), title: 'Work with the board', text: 'Follow the agent live, read cards, pause and resume.' },
  { section: findSection(/answering/i), title: 'Answer the agent', text: 'Unblock items that are waiting in Needs Human.' },
];

const guidePath = (s: GuideSection) => `/guide/${s.slug}`;

function mainScroller(): HTMLElement | null {
  return document.querySelector('main');
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SearchBox({
  value,
  onChange,
  size = 'md',
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  size?: 'md' | 'lg';
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="relative">
      <Search className={clsx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle', size === 'lg' ? 'left-4 size-5' : 'left-3 size-4')} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the guide"
        aria-label="Search the guide"
        className={clsx(
          'field-input',
          size === 'lg' ? 'h-12 rounded-xl pr-16 pl-12 text-[15px] shadow-card' : 'h-9 pr-9 pl-9',
        )}
      />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      ) : (
        size === 'lg' && (
          <kbd className="absolute top-1/2 right-4 hidden -translate-y-1/2 rounded sm:block border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-subtle">/</kbd>
        )
      )}
    </div>
  );
}

function SideNav({ active, query, setQuery }: { active?: string; query: string; setQuery: (v: string) => void }) {
  const results = useMemo(() => searchGuide(query), [query]);
  return (
    <nav className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 self-start overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:flex xl:w-72" aria-label="Guide sections">
      <Link to="/guide" className={clsx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition', !active ? 'text-accent' : 'text-fg hover:text-accent')}>
        <span className="brand-gradient flex size-7 items-center justify-center rounded-lg text-white">
          <BookOpen className="size-4" />
        </span>
        User guide
      </Link>
      <SearchBox value={query} onChange={setQuery} />
      <ol className="space-y-0.5">
        {results.map(({ section }) => {
          const Icon = iconFor(section);
          const isActive = active === section.slug;
          return (
            <li key={section.slug}>
              <Link
                to={guidePath(section)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition',
                  isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon className={clsx('size-4 shrink-0', isActive ? 'text-accent' : 'text-subtle group-hover:text-fg')} />
                <span className="w-4 shrink-0 text-right text-[11px] text-subtle tabular-nums">{section.number}</span>
                <span className="min-w-0 leading-snug">{section.title}</span>
              </Link>
            </li>
          );
        })}
        {results.length === 0 && <li className="px-2 py-3 text-xs text-subtle">No section matches “{query}”.</li>}
      </ol>
    </nav>
  );
}

function SectionCard({ section, snippet }: { section: GuideSection; snippet?: ReturnType<typeof searchGuide>[number]['snippet'] }) {
  const Icon = iconFor(section);
  return (
    <Link to={guidePath(section)} className="card group flex gap-4 p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition group-hover:scale-105">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-subtle tabular-nums">{String(section.number).padStart(2, '0')}</span>
          <span className="text-[15px] leading-snug font-semibold text-fg group-hover:text-accent">{section.title}</span>
        </span>
        <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
          {snippet ? (
            <>
              {snippet.before}
              <mark className="rounded bg-warning/25 px-0.5 text-fg">{snippet.match}</mark>
              {snippet.after}
            </>
          ) : (
            section.description
          )}
        </span>
      </span>
      <ChevronRight className="mt-2.5 size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

function Overview({ query, setQuery, searchRef, version }: { query: string; setQuery: (v: string) => void; searchRef: React.RefObject<HTMLInputElement | null>; version?: string }) {
  const results = useMemo(() => searchGuide(query), [query]);
  const hero = guideImageUrl('12-board.png');
  const introText = GUIDE.intro.split(/\n\s*\n/)[0]?.replace(/\*\*/g, '').replace(/\s+/g, ' ') ?? '';

  return (
    <>
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div className="pointer-events-none absolute -top-32 -left-24 size-[420px] rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent), transparent 70%)' }} />
        <div className="pointer-events-none absolute -right-24 -bottom-40 size-[420px] rounded-full opacity-20 blur-3xl" style={{ background: 'radial-gradient(circle, var(--accent-2), transparent 70%)' }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
              <BookOpen className="size-3.5" /> User guide{version ? ` · v${version}` : ''}
            </span>
            <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
              Everything you need to run <span className="brand-text">Loop Coder</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">{introText}</p>
            <div className="mt-6 max-w-xl">
              <SearchBox value={query} onChange={setQuery} size="lg" inputRef={searchRef} />
            </div>
          </div>
          {hero && (
            <div className="hidden lg:block [perspective:1600px]">
              <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop [transform:rotateY(-8deg)_rotateX(4deg)]">
                <span className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2" aria-hidden>
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </span>
                <img src={hero} alt="The Loop Coder board" className="block w-full" />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-5 py-10 sm:px-8">
        {query.trim() ? (
          <section>
            <h2 className="mb-4 text-lg font-semibold">
              {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {results.map((r) => (
                <SectionCard key={r.section.slug} section={r.section} snippet={r.snippet} />
              ))}
            </div>
            {results.length === 0 && <p className="text-sm text-muted">Nothing found. Try another word, or browse all topics.</p>}
          </section>
        ) : (
          <>
            <section>
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-subtle uppercase">Start here</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {START_HERE.filter((c) => c.section).map(({ section, title, text }) => {
                  const Icon = iconFor(section!);
                  return (
                    <Link key={title} to={guidePath(section!)} className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
                      <div className="brand-gradient absolute inset-x-0 top-0 h-1 opacity-0 transition group-hover:opacity-100" />
                      <span className="brand-gradient flex size-11 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_-8px_var(--accent)]">
                        <Icon className="size-5" />
                      </span>
                      <h3 className="mt-4 text-[15px] font-semibold group-hover:text-accent">{title}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                        Read <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-subtle uppercase">All topics</h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {GUIDE.sections.map((s) => (
                  <SectionCard key={s.slug} section={s} />
                ))}
              </div>
            </section>

            {findSection(/troubleshooting/i) && (
              <section className="card flex flex-wrap items-center gap-4 p-5">
                <span className="flex size-11 items-center justify-center rounded-xl bg-warning/12 text-warning">
                  <LifeBuoy className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold">Something not working?</h2>
                  <p className="text-[13px] text-muted">Paused or waiting agents, connection errors, locked accounts and more.</p>
                </div>
                <Link to={guidePath(findSection(/troubleshooting/i)!)} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[13px] font-medium transition hover:bg-surface-2">
                  Troubleshooting and FAQ <ArrowRight className="size-3.5" />
                </Link>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SectionPage({ section, onZoom }: { section: GuideSection; onZoom: (img: { src: string; alt: string }) => void }) {
  const navigate = useNavigate();
  const index = GUIDE.sections.indexOf(section);
  const prev = GUIDE.sections[index - 1];
  const next = GUIDE.sections[index + 1];
  const Icon = iconFor(section);

  return (
    <article className="mx-auto max-w-3xl px-5 pt-8 pb-16 sm:px-8">
      <nav className="flex items-center gap-1 text-[13px] text-muted" aria-label="Breadcrumb">
        <Link to="/guide" className="hover:text-fg">
          User guide
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="truncate text-fg">{section.title}</span>
      </nav>

      <div className="mt-3 lg:hidden">
        <select
          value={section.slug}
          onChange={(e) => navigate(`/guide/${e.target.value}`)}
          aria-label="Jump to section"
          className="field-input h-10 cursor-pointer"
        >
          {GUIDE.sections.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.number}. {s.title}
            </option>
          ))}
        </select>
      </div>

      <header className="mt-6 flex items-start gap-4 border-b border-line pb-6">
        <span className="brand-gradient flex size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_10px_30px_-10px_var(--accent)]">
          <Icon className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            Section {section.number} of {GUIDE.sections.length}
          </p>
          <h1 className="mt-1 text-3xl leading-tight font-semibold tracking-tight">{section.title}</h1>
        </div>
      </header>

      <div className="mt-6">
        <GuideMarkdown
          markdown={section.body}
          onZoom={onZoom}
          onSectionLink={(anchor) => {
            const target = resolveAnchor(anchor);
            // Unknown anchors and sub-headings on this page scroll in place.
            if (!target || (target.section === section && target.hash)) return false;
            navigate(guidePath(target.section) + (target.hash ? `#${target.hash}` : ''));
            return true;
          }}
        />
      </div>

      <div className="mt-14 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
        {prev ? (
          <Link to={guidePath(prev)} aria-label={`Previous: ${prev.title}`} className="card group p-4 transition hover:border-accent/40 hover:shadow-pop">
            <span className="flex items-center gap-1 text-xs text-subtle">
              <ArrowLeft className="size-3.5 transition group-hover:-translate-x-0.5" /> Previous
            </span>
            <span className="mt-1 block font-semibold group-hover:text-accent">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={guidePath(next)} aria-label={`Next: ${next.title}`} className="card group p-4 text-right transition hover:border-accent/40 hover:shadow-pop">
            <span className="flex items-center justify-end gap-1 text-xs text-subtle">
              Next <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block font-semibold group-hover:text-accent">{next.title}</span>
          </Link>
        )}
      </div>
    </article>
  );
}

/** Thin reading-progress bar for the scrolling content area. */
function ReadingProgress({ watch }: { watch: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = mainScroller();
    if (!el) return;
    const update = () => setProgress(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [watch]);
  return (
    <div className="sticky top-0 z-10 h-0.5 w-full bg-transparent" aria-hidden>
      <div className="brand-gradient h-full transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function GuidePage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const config = useConfig();
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const section = slug ? resolveSlug(slug) : undefined;

  // Links from before a renumbering land on the section's current address.
  useEffect(() => {
    if (section && slug !== section.slug) navigate(guidePath(section) + location.hash, { replace: true });
  }, [section, slug, location.hash, navigate]);

  // Older links used anchors (/guide#6-connecting-your-ai-agent): send them to the section page.
  useEffect(() => {
    if (!slug && location.hash) {
      const target = resolveAnchor(decodeURIComponent(location.hash.slice(1)));
      if (target) navigate(guidePath(target.section) + (target.hash ? `#${target.hash}` : ''), { replace: true });
    }
  }, [slug, location.hash, navigate]);

  // New section: start at the top (or at a sub-heading when the URL has one).
  useEffect(() => {
    const hash = location.hash.slice(1);
    requestAnimationFrame(() => {
      const target = hash && slug ? document.getElementById(decodeURIComponent(hash)) : null;
      if (target) target.scrollIntoView({ block: 'start' });
      else mainScroller()?.scrollTo({ top: 0 });
    });
  }, [slug, location.hash]);

  // "/" focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (slug) navigate('/guide');
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slug, navigate]);

  return (
    <div className="flex min-h-full">
      <SideNav active={section?.slug} query={query} setQuery={setQuery} />
      <div className="min-w-0 flex-1">
        <ReadingProgress watch={slug ?? 'overview'} />
        {section ? (
          <SectionPage key={section.slug} section={section} onZoom={setZoom} />
        ) : slug ? (
          <div className="mx-auto max-w-xl px-6 py-16 text-center">
            <h1 className="text-xl font-semibold">This page of the guide does not exist</h1>
            <Link to="/guide" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              Back to the user guide
            </Link>
          </div>
        ) : (
          <Overview query={query} setQuery={setQuery} searchRef={searchRef} version={config.data?.version.version} />
        )}
      </div>
      <Modal open={Boolean(zoom)} onClose={() => setZoom(null)} title={zoom?.alt || 'Screenshot'} size="xl">
        {zoom && <img src={zoom.src} alt={zoom.alt} className="w-full rounded-lg border border-line" />}
      </Modal>
    </div>
  );
}
