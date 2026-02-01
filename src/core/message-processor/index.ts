export * from './stream-events';
export * from './types';
export * from './errors';
// Export service but handle MessageProcessorError conflict
export {
  MessageProcessorService,
  MessageProcessorServiceLive,
  MessageProcessorServiceLiveWithConfig,
  type MessageProcessorConfig,
  type RouteOptions,
} from './service';
export type { MessageProcessorError as ExtendedMessageProcessorError } from './service';
// Re-export processor class but not the tag (to avoid conflict with service.ts)
export { MessageProcessor } from './processor';
