/**
 * Action types that can be executed when an intent is matched
 */
export type ActionType = 'agent' | 'function';

/**
 * Action to execute when an intent is matched
 */
export interface Action {
  type: ActionType;
  target: string; // Agent ID or function name
  payload?: Record<string, any>; // Optional payload to pass to the action
}

/**
 * Intent definition
 */
export interface Intent {
  id: string;
  utterances: string[]; // Phrases that trigger this intent
  action: Action;
  description?: string; // Optional description of the intent
}

/**
 * Intent match result
 */
export interface IntentMatch {
  intent: Intent;
  confidence: number; // 0-1 confidence score
  matchedUtterance?: string; // The utterance that matched
  matchType: 'exact' | 'regex' | 'semantic'; // How the match was made
}


