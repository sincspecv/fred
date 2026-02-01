/**
 * Pause Module
 *
 * Human-in-the-loop pause/resume functionality for pipeline workflows.
 *
 * @module pause
 *
 * @example
 * // In agent step - use request_human_input tool
 * const tool = createRequestHumanInputTool();
 * fred.registerTool(tool);
 *
 * @example
 * // In function step - return PauseRequest
 * const step: FunctionStep = {
 *   type: 'function',
 *   name: 'check_approval',
 *   fn: async (ctx) => {
 *     if (ctx.outputs.amount > 1000) {
 *       return { pause: true, prompt: 'Approve large purchase?' };
 *     }
 *     return { approved: true };
 *   },
 * };
 *
 * @example
 * // Detecting pause in executor
 * const pause = detectPauseSignal(stepResult);
 * if (pause) {
 *   // Save checkpoint with pause metadata
 * }
 */

// Types
export {
  type PauseSignal,
  type PauseRequest,
  type PauseMetadata,
  type PendingPause,
  type ResumeBehavior,
  type HumanInputResumeOptions,
  isPauseSignal,
  isPauseRequest,
  toPauseMetadata,
} from './types';

// Tool
export { createRequestHumanInputTool } from './tool';

// Detector
export { detectPauseSignal, type DetectedPause } from './detector';

// Manager
export { PauseManager, type PauseManagerOptions } from './manager';
