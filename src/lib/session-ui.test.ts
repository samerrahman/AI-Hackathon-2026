import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('active teaching session hides the source viewer and renders a chronological chat', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  const activeSession = app.slice(app.indexOf("{inWorkspace&&session&&<>"), app.indexOf("{screen==='recap'"));

  assert.ok(activeSession.includes('className="chat-thread"'));
  assert.ok(activeSession.includes('session.history.map'));
  assert.ok(activeSession.includes("m.role==='user'?'You':'Stu'"));
  assert.ok(activeSession.includes('YOU’RE TEACHING STU'));
  assert.ok(!activeSession.includes('DocumentViewer'));
  assert.ok(!activeSession.includes('Original source'));
  assert.ok(!activeSession.includes('citations('));
  assert.ok(!activeSession.includes('sourceLabel('));
  assert.ok(!activeSession.includes('Show me in the notes'));
});

test('the active session keeps progress, typed, spoken, pause, and completion controls', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('concepts demonstrated'));
  assert.ok(app.includes('Start explaining'));
  assert.ok(app.includes('aria-label="Your explanation"'));
  assert.ok(app.includes('Pause session'));
  assert.ok(app.includes('End session'));
});
