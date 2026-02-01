/**
 * Workflow context for tracking active workflow and thread state
 */

/**
 * WorkflowContext manages the current workflow and thread ID.
 *
 * Each workflow switch generates a fresh thread ID to prevent context carryover.
 */
export class WorkflowContext {
  private currentWorkflow: string;
  private threadId: string;

  constructor(initialWorkflow: string) {
    this.currentWorkflow = initialWorkflow;
    this.threadId = this.generateThreadId();
  }

  /**
   * Switch to a different workflow.
   * Generates a fresh thread ID to prevent context carryover.
   */
  switchWorkflow(name: string): void {
    this.currentWorkflow = name;
    this.threadId = this.generateThreadId();
  }

  /**
   * Get the current workflow name
   */
  getCurrentWorkflow(): string {
    return this.currentWorkflow;
  }

  /**
   * Get the current thread ID
   */
  getThreadId(): string {
    return this.threadId;
  }

  /**
   * Generate a unique thread ID
   */
  private generateThreadId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
