import { createHash } from 'crypto';
import { Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import { toDeterministicValue } from './artifact';

export function deterministicReplayHash(value: unknown): string {
  const normalized = JSON.stringify(toDeterministicValue(value));
  return createHash('sha256').update(normalized).digest('hex');
}

export function runEffectWithTestClock<A, E>(
  effect: Effect.Effect<A, E>,
  adjustmentsMs: ReadonlyArray<number>
): Promise<A> {
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.fork(effect);

    for (const adjustmentMs of adjustmentsMs) {
      yield* TestClock.adjust(Duration.millis(Math.max(0, adjustmentMs)));
    }

    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext));

  return Effect.runPromise(program);
}

export function deriveClockAdjustmentsFromOffsets(
  offsetsMs: ReadonlyArray<number>,
  extraMs = 1
): ReadonlyArray<number> {
  if (offsetsMs.length === 0) {
    return [];
  }

  const maxOffset = Math.max(...offsetsMs, 0);
  return [maxOffset + Math.max(0, extraMs)];
}
