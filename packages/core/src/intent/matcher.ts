import { Effect, Ref } from 'effect';
import { Intent, IntentMatch } from './intent';
import { IntentMatchError } from './errors';

/**
 * Function type for semantic matching.
 * Returns matched status, confidence score, and matched utterance.
 */
export type SemanticMatcherFn = (
  message: string,
  utterances: string[]
) => Promise<{ matched: boolean; confidence: number; utterance?: string }>;

/**
 * Intent matcher with hybrid matching strategy
 */
export class IntentMatcher {
  private intents: Ref.Ref<Intent[]>;

  constructor(intentsRef: Ref.Ref<Intent[]>) {
    this.intents = intentsRef;
  }

  /**
   * Register intents for matching
   */
  registerIntents(intents: Intent[]): Effect.Effect<void> {
    return Ref.set(this.intents, intents);
  }

  /**
   * Match a user message against registered intents
   * Uses hybrid strategy: exact → regex → semantic
   * Returns best match along with all candidate matches
   */
  matchIntent(
    message: string,
    semanticMatcher?: SemanticMatcherFn
  ): Effect.Effect<IntentMatch | null, IntentMatchError> {
    const self = this;
    return Effect.gen(function* () {
      const intents = yield* Ref.get(self.intents);
      const normalizedMessage = message.toLowerCase().trim();

      // Collect all candidates with their matched utterances
      const allCandidates: Array<{
        intentId: string;
        intentName: string;
        confidence: number;
        matchType: 'exact' | 'regex' | 'semantic';
        matchedUtterance?: string;
      }> = [];

      // Try exact match first
      for (const intent of intents) {
        for (const utterance of intent.utterances) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            allCandidates.push({
              intentId: intent.id,
              intentName: intent.description || intent.id,
              confidence: 1.0,
              matchType: 'exact' as const,
              matchedUtterance: utterance,
            });
          }
        }
      }

      // Try regex match - wrap in Effect.try for error handling
      for (const intent of intents) {
        for (const utterance of intent.utterances) {
          const regexResult = yield* Effect.try({
            try: () => {
              const regex = new RegExp(utterance, 'i');
              return regex.test(message) ? { intent, utterance } : null;
            },
            catch: () => null // Invalid regex, skip silently
          }).pipe(
            Effect.catchAll(() => Effect.succeed(null)) // Convert failures to null success
          );

          if (regexResult) {
            allCandidates.push({
              intentId: regexResult.intent.id,
              intentName: regexResult.intent.description || regexResult.intent.id,
              confidence: 0.8,
              matchType: 'regex' as const,
              matchedUtterance: regexResult.utterance,
            });
          }
        }
      }

      // Try semantic matching if provided
      if (semanticMatcher) {
        for (const intent of intents) {
          const result = yield* Effect.tryPromise({
            try: () => semanticMatcher(message, intent.utterances),
            catch: (error) => new IntentMatchError({
              message: 'Semantic matching failed',
              cause: error instanceof Error ? error : new Error(String(error))
            })
          });

          if (result.matched) {
            allCandidates.push({
              intentId: intent.id,
              intentName: intent.description || intent.id,
              confidence: result.confidence,
              matchType: 'semantic' as const,
              matchedUtterance: result.utterance,
            });
          }
        }
      }

      // No matches found
      if (allCandidates.length === 0) {
        return null;
      }

      // Sort by match type priority first (exact > regex > semantic), then confidence
      const matchTypePriority = { exact: 3, regex: 2, semantic: 1 };
      allCandidates.sort((a, b) => {
        const priorityDiff = matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
        if (priorityDiff !== 0) return priorityDiff;
        return b.confidence - a.confidence;
      });

      // Return best match with all candidates
      const best = allCandidates[0];
      const bestIntent = intents.find((i) => i.id === best.intentId)!;

      return {
        intent: bestIntent,
        confidence: best.confidence,
        matchType: best.matchType,
        matchedUtterance: best.matchedUtterance,
        allCandidates: allCandidates.map(({ matchedUtterance, ...rest }) => rest),
      };
    });
  }

  /**
   * Get all registered intents (Effect-based)
   */
  getIntentsEffect(): Effect.Effect<Intent[]> {
    return Ref.get(this.intents);
  }

  /**
   * Get all registered intents (synchronous for backward compatibility)
   */
  getIntents(): Intent[] {
    return Effect.runSync(Ref.get(this.intents));
  }

  /**
   * Clear all intents
   */
  clear(): Effect.Effect<void> {
    return Ref.set(this.intents, []);
  }
}

/**
 * Create a new IntentMatcher instance with synchronous initialization.
 * For use in constructor contexts where Effect cannot be awaited.
 */
export const createIntentMatcherSync = (): IntentMatcher => {
  const intentsRef = Ref.unsafeMake<Intent[]>([]);
  return new IntentMatcher(intentsRef);
};

/**
 * Create a new IntentMatcher instance with Effect-managed state.
 */
export const createIntentMatcher = (): Effect.Effect<IntentMatcher> =>
  Effect.gen(function* () {
    const intentsRef = yield* Ref.make<Intent[]>([]);
    return new IntentMatcher(intentsRef);
  });


