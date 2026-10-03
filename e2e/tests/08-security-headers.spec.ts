import { expect, test } from '@playwright/test';

// The E2E stack runs with the default FRAME_ANCESTORS=none.
test('the web server sends strict security headers and forbids framing by default', async ({ request }) => {
  for (const path of ['/', '/guide', '/assets/does-not-exist.js', '/nginx-health']) {
    const res = await request.get(path);
    const headers = res.headers();
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy'], path).toContain("script-src 'self'");
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(headers['server'], path).toBe('nginx');
  }
});

test('the app cannot be shown inside another site’s iframe', async ({ page, baseURL }) => {
  await page.setContent(`<iframe id="f" src="${baseURL}/login" width="800" height="600"></iframe>`);
  // Chromium replaces a frame blocked by frame-ancestors with its error page.
  await expect.poll(() => page.frames().find((f) => f !== page.mainFrame())?.url()).toMatch(/^chrome-error:/);
  await expect(page.frameLocator('#f').getByRole('button', { name: /sign in/i })).toHaveCount(0);
});
