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
  await expect(page.locator('.lesson-plan')).not.toContainText('explained independently');
  await page.getByRole('button', { name: 'Study settings' }).click();
  await expect(page.getByText('Fixed for this topic. Start a new topic to change it.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Teaching depth' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('A bounded sequence stays within a finite range, while convergence means approaching one limit.');
  await page.getByRole('button', { name: 'Add to board' }).click();
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
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByText('Step 5 Preview · Live')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Overall topic progress' })).toHaveAttribute('value', '2');
  await expect(page.locator('.app')).not.toContainText('cover');
  await expect(page.locator('.app')).not.toContainText('explain stage');
  await page.getByRole('button', { name: 'Study settings' }).click();
  await page.locator('.setting-row', { hasText: 'Show Judge Evidence' }).getByRole('button', { name: 'Off' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Judge evidence').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('A second branch gives current another path if one branch is open.');
  await page.getByRole('button', { name: 'Add to board' }).click();
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
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByRole('textbox', { name: 'Your explanation' })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.stu-desk .miso-character').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.locator('.stu-desk .stu-eye').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  // The sheet takes focus, closes on Escape or its X, and hands focus back to Topic.
  const topic = page.getByRole('button', { name: 'Topic', exact: true });
  await topic.click();
  await expect(page.getByRole('button', { name: 'Close topic panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lesson-plan')).toHaveCount(0);
  await expect(topic).toBeFocused();
  await topic.click();
  await page.getByRole('button', { name: 'Close topic panel' }).click();
  await expect(page.locator('.lesson-plan')).toHaveCount(0);
  await expect(topic).toBeFocused();
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible();
});

test('a sample can be taught to completion and flips into re-learn with citations', async ({ page }) => {
  await sample(page, 'research');
  await page.getByRole('textbox', { name: 'Your explanation' }).fill('Random sampling decides who enters a study, while random assignment decides who receives the treatment, so causal claims about the treatment are supported for people like the sample.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByText('You taught Stu the whole topic. Now he’ll teach it back.')).toBeVisible();
  const bar = page.getByRole('progressbar', { name: 'Overall topic progress' });
  await expect(bar).toHaveAttribute('value', await bar.getAttribute('max') ?? '');
  await expect(page.locator('.stu-message .citations button').first()).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Stu’s turn at the board' })).toBeVisible();
  await expect(page.locator('.board-entry.stu-message .citations button').first()).toBeVisible();
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
  await expect(page.locator('.plan-sources')).toHaveText('No notes · judged from general knowledge');
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

test('a sent explanation shows at once, typing meanwhile never cancels Stu, and unsent words come back', async ({ page }) => {
  let releaseFirst = () => {};
  const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
  let teachCalls = 0;
  await page.route('**/api/topic', route => route.fulfill({ json: { topicId: 'send-topic', stateToken: 'state-0', progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
    message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false } }));
  await page.route('**/api/teach', async route => {
    teachCalls++;
    if (teachCalls === 1) {
      await firstHeld;
      return route.fulfill({ json: { topicId: 'send-topic', stateToken: 'state-1', progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
        message: { id: 'stu-1', role: 'assistant', text: 'Oh! So what makes the leaf green?' }, liveStep5: true } });
    }
    if (teachCalls === 2) return route.fulfill({ status: 502, json: { error: 'Stu returned an incomplete response. Your message is safe; retry.', code: 'INVALID_MODEL_OUTPUT' } });
    await new Promise(() => {}); // Never answers: the page reloads mid-send.
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/stu.svg');
  expect((await page.request.get('/stu.svg')).ok()).toBe(true);
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Photosynthesis');
  await page.getByRole('button', { name: 'or just start talking' }).click();
  const box = page.getByRole('textbox', { name: 'Your explanation' });
  const sent = page.locator('.student-message .message-bubble');
  await box.fill('Plants use light to turn water and carbon dioxide into sugar.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  // On screen as sent, box cleared, Stu thinking, all before the server answers.
  await expect(sent).toHaveText(['Plants use light to turn water and carbon dioxide into sugar.']);
  await expect(box).toHaveValue('');
  await expect(page.getByLabel('Stu is thinking')).toBeVisible();
  await box.fill('Chlorophyll');
  releaseFirst();
  await expect(page.locator('.stu-message:not(.pending-message) .message-bubble').last()).toHaveText('Oh! So what makes the leaf green?');
  await expect(box).toHaveValue('Chlorophyll');
  // A failed send takes the bubble back out and returns the words to the box.
  await box.fill('Chlorophyll absorbs red and blue light.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByRole('alert')).toContainText('Stu returned an incomplete response');
  await expect(box).toHaveValue('Chlorophyll absorbs red and blue light.');
  await expect(sent).toHaveCount(1);
  // Reloading mid-send never saves an unconfirmed message; its words wait in the box.
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(sent).toHaveCount(2);
  await expect(page.locator('.save-indicator')).toContainText('Saved on this device');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Resume session' }).click();
  await expect(box).toHaveValue('Chlorophyll absorbs red and blue light.');
  await expect(sent).toHaveCount(1);
});

test('“Rewrite my last idea” brings the last explanation back and the Feynman loop moves to “Say it simpler”', async ({ page }) => {
  await sample(page);
  const box = page.getByRole('textbox', { name: 'Your explanation' });
  await box.fill('A bounded sequence stays within a finite range.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.locator('.student-message .message-bubble')).toHaveText('A bounded sequence stays within a finite range.');
  await expect(page.getByLabel('Stu is thinking')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rewrite my last idea' }).click();
  await expect(box).toHaveValue('A bounded sequence stays within a finite range.');
  await expect(box).toBeFocused();
  await expect(page.locator('.feynman-loop [aria-current="step"]')).toContainText('Say it simpler');
});

test('the keyboard writes on the board: Enter adds, Shift+Enter breaks a line, a busy Enter waits, and Cancel keeps words and focus', async ({ page }) => {
  let teachCalls = 0;
  await page.route('**/api/topic', route => route.fulfill({ json: { topicId: 'keys-topic', stateToken: 'state-0', progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
    message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false } }));
  await page.route('**/api/teach', async route => {
    teachCalls++;
    if (teachCalls === 1) return new Promise(() => {}); // Held: cancelled below.
    return route.fulfill({ json: { topicId: 'keys-topic', stateToken: `state-${teachCalls}`, progress: { total: 6, credited: 0, percent: 0, mode: 'teach' },
      message: { id: `stu-${teachCalls}`, role: 'assistant', text: 'Oh! So what makes the leaf green?' }, liveStep5: false } });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Topic title' }).fill('Photosynthesis');
  await page.getByRole('button', { name: 'or just start talking' }).click();
  const box = page.getByRole('textbox', { name: 'Your explanation' });
  await box.click();
  await page.keyboard.type('Line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('line two');
  await page.keyboard.press('Enter');
  const sent = page.locator('.student-message .message-bubble');
  await expect(sent).toHaveCount(1);
  expect(await sent.first().innerText()).toContain('\n');
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  // Stu is still thinking: Enter keeps the next idea in the box instead of sending it.
  await page.keyboard.type('Next idea while busy');
  await page.keyboard.press('Enter');
  expect(teachCalls).toBe(1);
  await expect(box).toHaveValue('Next idea while busy');
  await page.getByRole('button', { name: 'Cancel · keep my words' }).click();
  await expect(box).toHaveValue('Line one\nline two\n\nNext idea while busy');
  await expect(box).toBeFocused();
  await expect(sent).toHaveCount(0);
  // A keyboard send from Add to board keeps focus on the button.
  const add = page.getByRole('button', { name: 'Add to board' });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.stu-message:not(.pending-message) .message-bubble').last()).toHaveText('Oh! So what makes the leaf green?');
  await expect(add).toBeFocused();
  await expect(add).toHaveAttribute('aria-disabled', 'true');
});

test('a reply that lands while Notes is open is announced; a failed grading offers Check now; re-learn answers become “Your answer” notes', async ({ page }) => {
  await page.route('**/api/config', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), liveAvailable: true } });
  });
  await page.route('**/api/topic', route => route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'state-0', progress: { total: 4, credited: 0, percent: 0, mode: 'teach' },
    message: { id: 'welcome', role: 'assistant', text: 'Hi! Teach me this topic. What should I know first?' }, liveStep5: false } }));
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let replies = 0; let gradings = 0;
  await page.route('**/api/teach', async route => {
    replies++;
    if (replies === 1) await held;
    await route.fulfill({ json: replies === 1
      ? { topicId: 'mock-topic', stateToken: 'state-1', progress: { total: 4, credited: 0, percent: 0, mode: 'teach' }, message: { id: 'stu-1', role: 'assistant', text: 'Wait, why does the switch matter?' }, judgePending: true, liveStep5: true }
      : { topicId: 'mock-topic', stateToken: 'state-answer', progress: { total: 4, credited: 4, percent: 100, mode: 'relearn' }, message: { id: 'stu-2', role: 'assistant', text: 'Right! And what if there is a second branch?' }, liveStep5: true } });
  });
  await page.route('**/api/judge', async route => {
    gradings++;
    const sourceId = route.request().postDataJSON().documents[0].spans[0].id;
    if (gradings === 1) return route.fulfill({ status: 500, json: { error: 'The Judge timed out.' } });
    if (gradings === 2) return route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'state-graded', progress: { total: 4, credited: 4, percent: 100, mode: 'relearn' }, judgedMessageIds: [], transition: true, next: 'brief', liveStep5: true } });
    return route.fulfill({ json: { topicId: 'mock-topic', stateToken: 'state-brief', progress: { total: 4, credited: 4, percent: 100, mode: 'relearn' }, transition: true, liveStep5: true,
      message: { id: 'stu-teach-back', role: 'assistant', text: 'You taught me that a closed path lets current flow. What does an open switch do?', sourceIds: [sourceId] } } });
  });
  await pasteTopic(page);
  const box = page.getByRole('textbox', { name: 'Your explanation' });
  await box.fill('A closed path lets current flow through the lamp.');
  await page.getByRole('button', { name: 'Add to board' }).click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  release();
  await expect(page.getByRole('status').filter({ hasText: 'Stu wrote back on the board.' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Teach Stu', exact: true }).click();
  await expect(page.getByText('Stu wrote back on the board.')).toHaveCount(0);
  await expect(page.locator('.stu-message .message-bubble').last()).toHaveText('Wait, why does the switch matter?');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(box).toBeFocused();
  await expect(page.getByText('You taught Stu the whole topic. Now he’ll teach it back.')).toBeVisible();
  await expect(page.locator('.board-entry.stu-message .citations button')).toHaveCount(1);
  await box.fill('An open switch breaks the path, so no current flows.');
  await page.getByRole('button', { name: 'Answer Stu' }).click();
  await expect(page.locator('.your-answer')).toHaveCount(1);
  await expect(page.locator('.your-answer .message-bubble')).toHaveText('An open switch breaks the path, so no current flows.');
  await expect(page.getByRole('progressbar')).toHaveCount(1);
});
