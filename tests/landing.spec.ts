import { test, expect } from '@playwright/test';

// The welcome screen is the product landing page. These pin its structure and keyboard behaviour.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('phone landing: one h1, landmarks, menu focus handling, and Start teaching focuses Topic title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveCount(1);
  for (const role of ['banner', 'main', 'contentinfo'] as const) await expect(page.getByRole(role)).toHaveCount(1);
  await expect(page.locator('.app')).not.toContainText('cover');

  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'How it works' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  const title = page.getByRole('textbox', { name: 'Topic title' });
  await page.getByRole('main').getByRole('link', { name: 'Start teaching' }).first().click();
  await expect(title).toBeFocused();
  // The start card scrolls into view, not just the field at the bottom edge of the screen.
  await expect(page.getByRole('combobox', { name: 'Teaching depth' })).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('banner').getByRole('link', { name: 'Start teaching' }).click();
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
});

for (const width of [320, 1440]) {
  test(`welcome has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('closing a dialog hands focus back to the control that opened it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const how = page.getByRole('contentinfo').getByRole('button', { name: 'How it works' });
  await how.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(how).toBeFocused();

  const sample = page.getByRole('button', { name: 'Try a sample session' });
  await sample.click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(sample).toBeFocused();
});
