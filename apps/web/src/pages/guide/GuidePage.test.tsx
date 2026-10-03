import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidePage } from './GuidePage';

vi.mock('../../lib/queries', () => ({
  useConfig: () => ({ data: { version: { version: '9.9.9' } } }),
}));

function Where() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.hash}</output>;
}

function renderGuide(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/:slug" element={<GuidePage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('GuidePage', () => {
  it('shows the overview with search, start-here cards and every topic', () => {
    renderGuide('/guide');
    expect(screen.getByRole('heading', { level: 1, name: /Everything you need to run Loop Coder/ })).toBeTruthy();
    expect(screen.getByText(/User guide · v9\.9\.9/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Connect your AI agent/ }).getAttribute('href')).toBe('/guide/6-connecting-your-ai-agent');
    const nav = screen.getByRole('navigation', { name: 'Guide sections' });
    expect(within(nav).getAllByRole('link').length).toBeGreaterThanOrEqual(16);
    expect(screen.getByRole('link', { name: 'Troubleshooting and FAQ' })).toBeTruthy();
  });

  it('searches the guide and highlights matches', async () => {
    renderGuide('/guide');
    const [search] = screen.getAllByRole('searchbox', { name: 'Search the guide' });
    await userEvent.type(search!, 'setup code');
    expect(screen.getByRole('heading', { name: /results? for “setup code”/ })).toBeTruthy();
    expect(screen.getAllByText(/setup code/i, { selector: 'mark' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Start here')).toBeNull();

    await userEvent.clear(search!);
    await userEvent.type(search!, 'zzzz-nothing');
    expect(screen.getByText(/Nothing found/)).toBeTruthy();
  });

  it('renders a section page with breadcrumb, callouts, screenshots and prev/next', async () => {
    renderGuide('/guide/6-connecting-your-ai-agent');
    expect(screen.getByRole('heading', { level: 1, name: 'Connecting your AI agent' })).toBeTruthy();
    expect(screen.getByText(/Section 6 of \d+/)).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'User guide' }).getAttribute('href')).toBe('/guide');
    expect(screen.getByRole('link', { current: 'page' }).textContent).toContain('Connecting your AI agent');
    expect(screen.getByRole('heading', { level: 3, name: /Step 1: Create a project token/ }).getAttribute('id')).toBe('step-1-create-a-project-token');

    // GitHub alerts become callouts without the raw marker.
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.queryByText(/\[!WARNING\]/)).toBeNull();

    expect(screen.getByRole('link', { name: 'Previous: Creating a project' }).getAttribute('href')).toBe('/guide/5-creating-a-project');
    expect(screen.getByRole('link', { name: 'Next: What the agent does' }).getAttribute('href')).toBe('/guide/7-what-the-agent-does');

    // Screenshots open enlarged.
    const zoom = screen.getAllByRole('button', { name: /^Enlarge screenshot:/ })[0]!;
    await userEvent.click(zoom);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('switches sections from the mobile picker', async () => {
    renderGuide('/guide/1-key-ideas');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Jump to section' }), '11-sprints');
    expect(location()).toBe('/guide/11-sprints');
    expect(screen.getByRole('heading', { level: 1, name: 'Sprints' })).toBeTruthy();
  });

  it('redirects old anchor links to the section page', () => {
    renderGuide('/guide#6-connecting-your-ai-agent');
    expect(location()).toBe('/guide/6-connecting-your-ai-agent');
    expect(screen.getByRole('heading', { level: 1, name: 'Connecting your AI agent' })).toBeTruthy();
  });

  it('redirects old sub-heading anchors to the section that holds them', () => {
    renderGuide('/guide#step-1-create-a-project-token');
    expect(location()).toBe('/guide/6-connecting-your-ai-agent#step-1-create-a-project-token');
  });

  it('shows a friendly message for an unknown section', () => {
    renderGuide('/guide/no-such-page');
    expect(screen.getByRole('heading', { name: /does not exist/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the user guide' }).getAttribute('href')).toBe('/guide');
  });

  it('"/" jumps to the search box', async () => {
    renderGuide('/guide/3-signing-in');
    await userEvent.keyboard('/');
    expect(location()).toBe('/guide');
    // The large search box in the overview hero (the second one; the first is in the side navigation).
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('searchbox', { name: 'Search the guide' })[1]));
  });
});
