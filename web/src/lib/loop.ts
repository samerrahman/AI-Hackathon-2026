export type LoopStep = 1 | 2 | 3 | 4;
/** Where the teacher is in the Feynman loop, from local UI state only: never from the Judge. */
export function loopStep({ rounds, writing, thinking }: { rounds: number; writing: boolean; thinking: boolean }): LoopStep {
  if (thinking) return 3;
  if (rounds === 0) return writing ? 2 : 1;
  return writing ? 4 : 3;
}
