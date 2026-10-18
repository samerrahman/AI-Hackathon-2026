import { test, expect, type Page } from '@playwright/test';

async function sample(page: Page, subject: 'analysis' | 'research' = 'analysis') {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Try a sample session' }).click();
  await page.getByRole('button', { name: subject === 'analysis' ? 'Sequences & convergence Real analysis' : 'Experiments & causal claims Research methods' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
  await expect(page.locator('.stu-message .message-bubble').last()).toContainText('Teach me this topic');
}
async function pasteTopic(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Lamp circuits');
  await page.getByRole('combobox', { name: 'Teaching depth' }).selectOption('exam-ready');
  await page.getByRole('button', { name: 'Paste notes' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Circuit notes');
  await page.getByLabel('Lecture text').fill('A complete circuit has a battery and closed conducting path. An open switch breaks the path, so no current flows through the lamp. A second branch can provide another path.');
  await page.getByRole('button', { name: 'Add these notes' }).click();
  await page.getByRole('button', { name: 'Start teaching' }).click();
}

test('sample keeps source viewer, one overall bar, fixed depth, local resume, and honest label', async ({ page }) => {
  await sample(page);
  await expect(page.getByText('Sample demo', { exact: true })).toBeVisible();
  await expect(page.getByText('Step 5 Preview · Live')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page.getByRole('button', { name: 'Teach Stu', exact: true }).click();
  await expect(page.locator('.concept-sidebar')).not.toContainText('explained independently');
  await page.getByRole('button', { name: 'Study settings' }).click();
  await expect(page.getByText('Fixed for this topic. Start a new topic to change it.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Teaching depth' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('A bounded sequence stays within a finite range, while convergence means approaching one limit.');
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('');
  await expect(page.getByText('Step 5 Preview · Live')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause session' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Resume session' }).click();
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveCount(1);
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: /Here’s what you/ })).toBeVisible();
});

test('pasted notes are the simple path and provider errors preserve them', async ({ page }) => {
  await page.route('**/api/topic', async route => route.fulfill({ status: 503, json: { error: 'Live teaching needs STEPFUN_API_KEY on the server.' } }));
  await pasteTopic(page);
  await expect(page.getByRole('alert')).toContainText('STEPFUN_API_KEY');
  await expect(page.getByRole('textbox', { name: 'Topic title' })).toHaveValue('Lamp circuits');
  await expect(page.getByText('Circuit notes', { exact: true })).toBeVisible();
});

test('mocked live dual-model turn shows honest status, one bar, debug evidence, and re-learn citations', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), liveAvailable: true, judgeDebugAvailable: true } });
  });
  await page.route('**/api/topic', async route => route.fulfill({ json: {
    topicId: 'mock-topic', stateToken: 'opaque-encrypted-state-token', progress: { total: 8, credited: 0, percent: 0, mode: 'teach' },
    message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false,
  } }));
  let calls = 0;
  await page.route('**/api/teach', async route => {
    calls++;
    const request = route.request().postDataJSON();
    const sourceId = request.documents[0].spans[0].id;
    await route.fulfill({ json: {
      topicId: 'mock-topic', stateToken: `opaque-state-after-${calls}`, progress: calls === 1 ? { total: 8, credited: 2, percent: 25, mode: 'teach' } : { total: 8, credited: 8, percent: 100, mode: 'relearn' },
      message: calls === 1 ? { id: 'stu-1', role: 'assistant', text: 'Wait, why does opening the switch stop the lamp?' }
        : { id: 'stu-2', role: 'assistant', text: 'You taught me that the path must be closed. An open switch breaks it. What happens if there is another branch?', sourceIds: [sourceId] },
      transition: calls > 1, liveStep5: true,
      debug: { credits: [{ itemId: 'opaque-item-1', quote: request.text }], revocations: [], problems: [],
        focus: { type: 'vague', anchorQuote: request.text, instruction: 'ask_clarify' }, mistakeAccepted: false,
        models: { judge: 'step-5-preview', stu: 'step-3.7-flash' }, durationMs: { judge: 12, stu: 4 } },
    } });
  });
  await pasteTopic(page);
  await expect(page.getByText('Step 5 Preview · Live')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('A closed path allows current through the lamp.');
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(page.getByText('Step 5 Preview · Live')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveAttribute('value', '2');
  await expect(page.locator('.app')).not.toContainText('cover');
  await expect(page.locator('.app')).not.toContainText('explain stage');
  await page.getByRole('button', { name: 'Study settings' }).click();
  await page.locator('.setting-row', { hasText: 'Show Judge Evidence' }).getByRole('button', { name: 'Off' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Judge evidence').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('A second branch gives current another path if one branch is open.');
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(page.getByText('You taught Stu the whole topic. Now he’ll teach it back.')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveAttribute('value', '8');
  await expect(page.locator('.stu-message .citations button')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveCount(1);
});

test('mobile topic panel, notes tab, and typed path avoid horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sample(page, 'research');
  await expect(page.getByRole('progressbar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Topic', exact: true }).click();
  await expect(page.locator('.topic-panel')).toContainText('Big picture');
  await page.getByRole('button', { name: 'Open notes' }).click();
  await expect(page.locator('.document-paper')).toBeVisible();
  await page.getByRole('button', { name: 'Teach Stu', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('Random sampling selects people, while random assignment allocates treatment.');
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.chat-stu .miso-character').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('a sample can be taught to completion and flips into re-learn with citations', async ({ page }) => {
  await sample(page, 'research');
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('Random sampling decides who enters a study, while random assignment decides who receives the treatment, so causal claims about the treatment are supported for people like the sample.');
  await page.getByRole('button', { name: 'Send explanation' }).click();
  await expect(page.getByText('You taught Stu the whole topic. Now he’ll teach it back.')).toBeVisible();
  const bar = page.getByRole('progressbar', { name: 'Overall topic progress' });
  await expect(bar).toHaveAttribute('value', await bar.getAttribute('max') ?? '');
  await expect(page.locator('.stu-message .citations button').first()).toBeVisible();
  await page.locator('.stu-message .citations button').first().click();
  await expect(page.locator('.document-paper')).toBeVisible();
});

test('Stu’s expression playground previews each state without a session', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Test Stu’s expressions' }).click();
  for (const state of ['Puzzled', 'Pleased', 'Thinking']) {
    await page.getByRole('button', { name: state }).click();
    await expect(page.locator('.expression-stage .miso-character')).toHaveAttribute('data-state', state.toLowerCase());
  }
});
