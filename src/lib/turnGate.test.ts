import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnGate } from './turnGate';
test('late assessment is rejected after correction, navigation, or a new session', () => {
  const gate = new TurnGate(); const old = gate.begin(); const correction = gate.begin();
  assert.equal(old.signal.aborted, true); assert.equal(gate.current(old.revision), false);
  assert.equal(gate.current(correction.revision), true); gate.cancel();
  assert.equal(gate.current(correction.revision), false);
});
test('a refreshed browser starts above ordinary previous-session revisions', () => {
  const gate = new TurnGate();
  assert.ok(gate.begin().revision > 1_000_000);
  assert.ok(Number.isSafeInteger(gate.begin().revision));
});
