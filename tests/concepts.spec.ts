import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

async function savedPlan(page: Page) {
  return page.evaluate(() => new Promise<{
    concepts: { id: string; title: string; sourceIds: string[] }[];
    selected: string[];
    documents: { id: string; name: string; spans: { id: string; documentId: string; pageIndex: number }[] }[];
  }>((resolve, reject) => {
    const open = indexedDB.open('miso-local-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('session', 'readonly').objectStore('session').get('current-session');
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }));
}

test('add concept after reload and resume uses the displayed document and persists selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: 'Sequences & convergence Real analysis' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
  await expect(page.getByRole('button', { name: 'Give me a hint' })).toBeEnabled();
  await expect(page.locator('.save-indicator')).toContainText('Saved on this device');
  await page.getByRole('button', { name: 'Pause session' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await page.getByRole('button', { name: 'Edit study plan' }).click();
  await page.getByText('Choose a page range or add a concept', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toContainText('Sequences_and_Convergence.pdf');
  const title = 'Bounds and oscillation revisited';
  await page.getByRole('textbox', { name: 'New concept title' }).fill(title);
  await page.getByRole('button', { name: 'Add concept', exact: true }).click();
  const added = page.locator('.concept-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(added).toBeVisible();
  await expect(added.getByRole('checkbox')).toBeChecked();
  await expect(added.locator('.source-text')).toContainText('Sequences_and_Convergence');
  await expect(page.getByRole('textbox', { name: 'New concept title' })).toHaveValue('');
  await expect.poll(async () => (await savedPlan(page)).concepts.some(concept => concept.title === title)).toBe(true);
  const state = await savedPlan(page);
  const concept = state.concepts.find(item => item.title === title)!;
  expect(state.selected).toContain(concept.id);
  expect(concept.sourceIds.length).toBeGreaterThan(0);
  expect(concept.sourceIds.every(id => state.documents[0].spans.some(span => span.id === id))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Resume session' }).click();
  await page.getByRole('button', { name: 'Edit study plan' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/miso-added-concept.png', fullPage: true });
});

test('Enter adds a concept from the chosen document page and rejects invalid ranges', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), liveAvailable: false } });
  });
  await page.goto('/');
  await page.getByLabel('Choose PDF files').setInputFiles([
    resolve('public/examples/Sequences_and_Convergence.pdf'),
    resolve('public/examples/Experiments_and_Causal_Claims.pdf'),
  ]);
  await page.getByRole('button', { name: 'Prepare my session' }).click();
  await page.getByText('Choose a page range or add a concept', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption({ label: 'Experiments_and_Causal_Claims.pdf' });
  await page.getByLabel('From', { exact: true }).fill('2');
  await page.getByLabel('To', { exact: true }).fill('1');
  const title = 'Reading a causal claim carefully';
  await page.getByRole('textbox', { name: 'New concept title' }).fill(title);
  await page.getByRole('button', { name: 'Add concept', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('page range');
  await expect(page.getByRole('textbox', { name: 'New concept title' })).toHaveValue(title);
  await page.getByLabel('To', { exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'New concept title' }).press('Enter');
  const added = page.locator('.concept-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(added).toBeVisible();
  await expect(added.locator('.source-text')).toContainText('Experiments_and_Causal_Claims · p. 2');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await savedPlan(page)).concepts.length).toBe(1);
  const state = await savedPlan(page);
  const source = state.documents.find(document => document.name === 'Experiments_and_Causal_Claims.pdf')!;
  expect(state.concepts[0].sourceIds.every(id => source.spans.some(span => span.id === id && span.pageIndex === 1))).toBe(true);
  expect(state.selected).toEqual([state.concepts[0].id]);
});
