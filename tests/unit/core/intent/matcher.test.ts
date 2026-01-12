import { describe, test, expect, beforeEach } from 'bun:test';
import { IntentMatcher } from '../../../../src/core/intent/matcher';
import { Intent } from '../../../../src/core/intent/intent';

describe('IntentMatcher', () => {
  let matcher: IntentMatcher;

  beforeEach(() => {
    matcher = new IntentMatcher();
  });

  function createIntent(id: string, utterances: string[], actionType: 'agent' | 'function' = 'agent'): Intent {
    return {
      id,
      utterances,
      action: {
        type: actionType,
        target: `${id}-agent`,
      },
    };
  }

  describe('registerIntents', () => {
    test('should register intents', () => {
      const intents = [
        createIntent('intent-1', ['hello', 'hi']),
        createIntent('intent-2', ['goodbye', 'bye']),
      ];

      matcher.registerIntents(intents);

      const registered = matcher.getIntents();
      expect(registered).toHaveLength(2);
      expect(registered).toContain(intents[0]);
      expect(registered).toContain(intents[1]);
    });

    test('should replace existing intents when registering again', () => {
      const intents1 = [createIntent('intent-1', ['hello'])];
      const intents2 = [createIntent('intent-2', ['goodbye'])];

      matcher.registerIntents(intents1);
      expect(matcher.getIntents()).toHaveLength(1);

      matcher.registerIntents(intents2);
      expect(matcher.getIntents()).toHaveLength(1);
      expect(matcher.getIntents()[0].id).toBe('intent-2');
    });
  });

  describe('getIntents', () => {
    test('should return all registered intents', () => {
      const intents = [
        createIntent('intent-1', ['hello']),
        createIntent('intent-2', ['goodbye']),
      ];

      matcher.registerIntents(intents);
      const retrieved = matcher.getIntents();

      expect(retrieved).toHaveLength(2);
      expect(retrieved).toEqual(intents);
    });

    test('should return empty array when no intents registered', () => {
      expect(matcher.getIntents()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    test('should clear all intents', () => {
      const intents = [
        createIntent('intent-1', ['hello']),
        createIntent('intent-2', ['goodbye']),
      ];

      matcher.registerIntents(intents);
      expect(matcher.getIntents()).toHaveLength(2);

      matcher.clear();
      expect(matcher.getIntents()).toHaveLength(0);
    });
  });

  describe('matchIntent - exact matching', () => {
    test('should match exact utterance', async () => {
      const intent = createIntent('greeting', ['hello', 'hi']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('hello');
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('greeting');
      expect(match?.confidence).toBe(1.0);
      expect(match?.matchType).toBe('exact');
      expect(match?.matchedUtterance).toBe('hello');
    });

    test('should match case-insensitive', async () => {
      const intent = createIntent('greeting', ['Hello']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('HELLO');
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('greeting');
      expect(match?.matchType).toBe('exact');
    });

    test('should match with trimmed whitespace', async () => {
      const intent = createIntent('greeting', ['  hello  ']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('hello');
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('greeting');
      expect(match?.matchType).toBe('exact');
    });

    test('should return null when no exact match', async () => {
      const intent = createIntent('greeting', ['hello']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('goodbye');
      expect(match).toBeNull();
    });

    test('should prioritize first matching intent', async () => {
      const intent1 = createIntent('greeting-1', ['hello']);
      const intent2 = createIntent('greeting-2', ['hello']);
      matcher.registerIntents([intent1, intent2]);

      const match = await matcher.matchIntent('hello');
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('greeting-1');
    });
  });

  describe('matchIntent - regex matching', () => {
    test('should match regex pattern', async () => {
      const intent = createIntent('weather', ['weather in (.+)']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('weather in New York');
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('weather');
      expect(match?.confidence).toBe(0.8);
      expect(match?.matchType).toBe('regex');
    });

    test('should match case-insensitive regex', async () => {
      const intent = createIntent('greeting', ['^hello']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('HELLO world');
      expect(match).not.toBeNull();
      expect(match?.matchType).toBe('regex');
    });

    test('should skip invalid regex patterns', async () => {
      const intent = createIntent('invalid', ['[invalid regex']);
      matcher.registerIntents([intent]);

      // Should not throw, but should not match either
      const match = await matcher.matchIntent('test');
      expect(match).toBeNull();
    });

    test('should return null when no regex match', async () => {
      const intent = createIntent('weather', ['weather in (.+)']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('hello world');
      expect(match).toBeNull();
    });

    test('should try regex after exact match fails', async () => {
      const intent = createIntent('weather', ['weather']);
      matcher.registerIntents([intent]);

      // Exact match should work first
      const exactMatch = await matcher.matchIntent('weather');
      expect(exactMatch?.matchType).toBe('exact');

      // Regex match should work for pattern
      const intent2 = createIntent('weather-pattern', ['weather in (.+)']);
      matcher.registerIntents([intent2]);

      const regexMatch = await matcher.matchIntent('weather in NYC');
      expect(regexMatch?.matchType).toBe('regex');
    });
  });

  describe('matchIntent - semantic matching', () => {
    test('should use semantic matcher when provided', async () => {
      const intent = createIntent('greeting', ['hello', 'hi']);
      matcher.registerIntents([intent]);

      const semanticMatcher = async (message: string, utterances: string[]) => {
        return {
          matched: true,
          confidence: 0.9,
          utterance: 'hello',
        };
      };

      const match = await matcher.matchIntent('hey there', semanticMatcher);
      expect(match).not.toBeNull();
      expect(match?.intent.id).toBe('greeting');
      expect(match?.matchType).toBe('semantic');
      expect(match?.confidence).toBe(0.9);
    });

    test('should return null when semantic matcher returns no match', async () => {
      const intent = createIntent('greeting', ['hello']);
      matcher.registerIntents([intent]);

      const semanticMatcher = async () => {
        return {
          matched: false,
          confidence: 0.3,
        };
      };

      const match = await matcher.matchIntent('unrelated message', semanticMatcher);
      expect(match).toBeNull();
    });

    test('should not use semantic matching when not provided', async () => {
      const intent = createIntent('greeting', ['hello']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('hey there');
      expect(match).toBeNull();
    });

    test('should try semantic matching after exact and regex fail', async () => {
      const intent = createIntent('greeting', ['hello']);
      matcher.registerIntents([intent]);

      let callOrder: string[] = [];
      const semanticMatcher = async (message: string, utterances: string[]) => {
        callOrder.push('semantic');
        return {
          matched: true,
          confidence: 0.8,
          utterance: 'hello',
        };
      };

      // Should not match exactly or via regex
      const match = await matcher.matchIntent('hey there', semanticMatcher);
      expect(match).not.toBeNull();
      expect(match?.matchType).toBe('semantic');
      expect(callOrder).toContain('semantic');
    });
  });

  describe('matchIntent - priority', () => {
    test('should prioritize exact match over regex', async () => {
      const intent = createIntent('greeting', ['hello', '^hello']);
      matcher.registerIntents([intent]);

      const match = await matcher.matchIntent('hello');
      expect(match?.matchType).toBe('exact');
      expect(match?.confidence).toBe(1.0);
    });

    test('should prioritize regex over semantic', async () => {
      const intent = createIntent('greeting', ['^hello']);
      matcher.registerIntents([intent]);

      const semanticMatcher = async () => {
        return {
          matched: true,
          confidence: 0.9,
          utterance: 'hello',
        };
      };

      const match = await matcher.matchIntent('hello world');
      expect(match?.matchType).toBe('regex');
      expect(match?.confidence).toBe(0.8);
    });

    test('should use semantic only when exact and regex fail', async () => {
      const intent = createIntent('greeting', ['hello']);
      matcher.registerIntents([intent]);

      const semanticMatcher = async () => {
        return {
          matched: true,
          confidence: 0.7,
          utterance: 'hello',
        };
      };

      // No exact match, no regex match
      const match = await matcher.matchIntent('hey', semanticMatcher);
      expect(match?.matchType).toBe('semantic');
    });
  });
});
