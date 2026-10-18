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
  // Stu replies first (/api/teach); the Step 5 Judge grades in the background (/api/judge).
  let replies = 0; let gradings = 0; let lastText = ''; let lastMessageId = '';
  await page.route('**/api/teach', async route => {
    replies++;
    ({ text: lastText, messageId: lastMessageId } = route.request().postDataJSON());
    await route.fulfill({ json: {
      topicId: 'mock-topic', stateToken: `opaque-state-reply-${replies}`, progress: replies === 1 ? { total: 8, credited: 0, percent: 0, mode: 'teach' } : { total: 8, credited: 2, percent: 25, mode: 'teach' },
      message: { id: `stu-${replies}`, role: 'assistant', text: replies === 1 ? 'Wait, why does opening the switch stop the lamp?' : 'So another branch is like a second road?' },
      judgePending: true, liveStep5: false,
    } });
  });
  await page.route('**/api/judge', async route => {
    gradings++;
    const request = route.request().postDataJSON();
    const sourceId = request.documents[0].spans[0].id;
    const debug = { credits: [{ itemId: 'opaque-item-1', quote: lastText }], revocations: [], problems: [],
      focus: { type: 'vague', anchorQuote: lastText, instruction: 'ask_clarify' }, mistakeAccepted: false,
      models: { judge: 'step-5-preview', stu: 'step-3.7-flash' }, durationMs: { judge: 12, stu: 0 } };
    if (gradings === 1) return route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'opaque-state-graded-1', progress: { total: 8, credited: 2, percent: 25, mode: 'teach' },
      judgedMessageIds: [lastMessageId], liveStep5: true, debug } });
    if (gradings === 2) return route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'opaque-state-graded-2', progress: { total: 8, credited: 8, percent: 100, mode: 'relearn' },
      judgedMessageIds: [], transition: true, next: 'brief', liveStep5: true } });
    return route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'opaque-state-teach-back', progress: { total: 8, credited: 8, percent: 100, mode: 'relearn' }, transition: true, liveStep5: true,
      message: { id: 'stu-teach-back', role: 'assistant', text: 'You taught me that the path must be closed. An open switch breaks it. What happens if there is another branch?', sourceIds: [sourceId] } } });
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

test('“or just start talking” starts a topic with no notes and no Notes tab', async ({ page }) => {
  let topicBody: { documents: unknown[] } | undefined;
  await page.route('**/api/topic', async route => {
    topicBody = route.request().postDataJSON();
    await route.fulfill({ json: { topicId: 'talk-topic', stateToken: 'opaque-encrypted-state-token', progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
      message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Photosynthesis');
  await page.getByRole('button', { name: 'or just start talking' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toBeVisible();
  expect(topicBody?.documents).toEqual([]);
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Look at my notes' })).toHaveCount(0);
});

test('“or just start talking” without a title points at the title field, and errors stay visible when scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const talk = page.getByRole('button', { name: 'or just start talking' });
  await talk.scrollIntoViewIfNeeded();
  await talk.click();
  const title = page.getByRole('textbox', { name: 'Topic title' });
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
  await expect(page.getByText('Give your topic a title first, then pick how to start.')).toBeVisible();
  await page.route('**/api/topic', route => route.fulfill({ status: 504, json: { error: 'StepFun took too long. Your message is safe; retry.', code: 'PROVIDER_TIMEOUT' } }));
  await title.fill('Photosynthesis');
  await expect(title).toHaveAttribute('aria-invalid', 'false');
  await talk.scrollIntoViewIfNeeded();
  await talk.click();
  await expect(page.getByRole('alert')).toContainText('StepFun took too long');
  await expect(page.getByRole('alert')).toBeInViewport();
});
