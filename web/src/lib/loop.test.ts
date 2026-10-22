import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopStep } from './loop';

test('the Feynman loop step follows local UI state only', () => {
  const cases: [rounds: number, writing: boolean, thinking: boolean, expected: number][] = [
    [0, false, false, 1], // nothing taught yet: pick one idea
    [0, true, false, 2], // writing the first explanation
    [0, true, true, 3], // Stu is reading the first explanation
    [1, false, false, 3], // Stu's question shows the gap
    [1, true, false, 4], // filling the gap in plainer words
    [2, true, true, 3], // thinking always means Stu is looking for the gap
  ];
  for (const [rounds, writing, thinking, expected] of cases) {
    assert.equal(loopStep({ rounds, writing, thinking }), expected, `rounds=${rounds} writing=${writing} thinking=${thinking}`);
  }
});
