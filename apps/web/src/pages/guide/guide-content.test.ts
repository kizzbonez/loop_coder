import { describe, expect, it } from 'vitest';
import { GUIDE, GUIDE_IMAGES, GUIDE_MARKDOWN, guideImageUrl, headingSlug, parseGuide, plainText, resolveAnchor, searchGuide } from './guide-content';

describe('in-app user guide', () => {
  it('bundles docs/USER_GUIDE.md', () => {
    expect(GUIDE_MARKDOWN).toMatch(/^# Loop Coder user guide/);
  });

  it('creates GitHub-compatible heading anchors', () => {
    expect(headingSlug('6. Connecting your AI agent')).toBe('6-connecting-your-ai-agent');
    expect(headingSlug('2. First-time setup (administrator)')).toBe('2-first-time-setup-administrator');
    expect(headingSlug('Step 1: Create a project token')).toBe('step-1-create-a-project-token');
  });

  it('splits the guide into numbered section pages', () => {
    expect(GUIDE.title).toBe('Loop Coder user guide');
    expect(GUIDE.sections.length).toBeGreaterThanOrEqual(15);
    expect(GUIDE.sections[0]).toMatchObject({ number: 1, title: 'Key ideas', slug: '1-key-ideas' });
    expect(GUIDE.sections.map((s) => s.title)).not.toContain('Contents');
    expect(GUIDE.sections.map((s) => s.number)).toEqual(GUIDE.sections.map((_, i) => i + 1));
    for (const s of GUIDE.sections) {
      expect(s.body, s.title).not.toMatch(/^## /m);
      expect(s.description.length, s.title).toBeGreaterThan(20);
      expect(s.description.length, s.title).toBeLessThanOrEqual(150);
    }
  });

  it('parses a small guide', () => {
    const guide = parseGuide(
      '# Title\n\nIntro **text**.\n\n![hero](images/guide/x.png)\n\n---\n\n## Contents\n\n- [A](#1-alpha)\n\n## 1. Alpha\n\n> [!TIP]\n> Skip me.\n\n**First** paragraph about `alpha`.\n\n### Sub heading\n\nMore.\n\n---\n\n## 2. Beta\n\n- a list\n\nBeta text. It has these parts:\n\n- one\n',
    );
    expect(guide.title).toBe('Title');
    expect(guide.intro).toBe('Intro **text**.');
    expect(guide.sections.map((s) => [s.number, s.title, s.slug])).toEqual([
      [1, 'Alpha', '1-alpha'],
      [2, 'Beta', '2-beta'],
    ]);
    expect(guide.sections[0]!.description).toBe('First paragraph about alpha.');
    expect(guide.sections[0]!.body).not.toMatch(/---\s*$/);
    expect(guide.sections[1]!.description).toBe('Beta text.');
    expect(resolveAnchor('sub-heading', guide.sections)).toEqual({ section: guide.sections[0], hash: 'sub-heading' });
  });

  it('converts markdown to plain text for search', () => {
    expect(plainText('**Bold** [link](https://x.y) `code` ![img](a.png)\n> [!NOTE]\n> quoted')).toBe('Bold link code quoted');
  });

  it('every in-guide anchor link resolves to a section page', () => {
    const anchors = [...GUIDE_MARKDOWN.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(anchors.length).toBeGreaterThan(10);
    for (const anchor of anchors) expect(resolveAnchor(anchor), anchor).toBeTruthy();
    expect(resolveAnchor('6-connecting-your-ai-agent')).toEqual({ section: GUIDE.sections[5] });
    expect(resolveAnchor('step-1-create-a-project-token')).toEqual({ section: GUIDE.sections[5], hash: 'step-1-create-a-project-token' });
    expect(resolveAnchor('nope')).toBeUndefined();
  });

  it('searches titles first, then text, with a highlighted snippet', () => {
    expect(searchGuide('  ')).toHaveLength(GUIDE.sections.length);
    const results = searchGuide('sprint');
    expect(results[0]!.section.title).toBe('Sprints');
    expect(results.length).toBeGreaterThan(1);
    const textHit = results.find((r) => r.section.title !== 'Sprints' && r.snippet);
    expect(textHit?.snippet?.match.toLowerCase()).toBe('sprint');
    expect(searchGuide('SETUP CODE').length).toBeGreaterThan(0);
    expect(searchGuide('zzzz-not-in-guide')).toEqual([]);
  });

  it('bundles every screenshot the guide references', () => {
    const referenced = [...GUIDE_MARKDOWN.matchAll(/\]\((images\/guide\/[^)]+\.png)\)/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThanOrEqual(30);
    for (const src of referenced) expect(guideImageUrl(src), src).toBeTruthy();
    expect(GUIDE_IMAGES.size).toBeGreaterThanOrEqual(referenced.length);
  });

  it('ignores unknown images', () => {
    expect(guideImageUrl('images/guide/nope.png')).toBeUndefined();
    expect(guideImageUrl(undefined)).toBeUndefined();
  });
});
