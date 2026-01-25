/**
 * WorkflowManager for registering and validating workflows
 */

import type { Fred } from '../../index';
import type { Workflow } from './types';

/**
 * WorkflowManager stores and validates workflows.
 *
 * Workflows are validated at registration time - missing agents
 * trigger console warnings but do not throw errors.
 */
export class WorkflowManager {
  private workflows: Map<string, Workflow> = new Map();
  private fred: Fred;

  constructor(fred: Fred) {
    this.fred = fred;
  }

  /**
   * Add a workflow to the registry.
   * Validates that referenced agents exist (warns, doesn't throw).
   */
  addWorkflow(name: string, config: Omit<Workflow, 'name'>): void {
    const workflow: Workflow = { name, ...config };
    this.workflows.set(name, workflow);
    this.validateWorkflow(name, workflow);
  }

  /**
   * Get a workflow by name
   */
  getWorkflow(name: string): Workflow | undefined {
    return this.workflows.get(name);
  }

  /**
   * List all workflow names
   */
  listWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Check if a workflow exists
   */
  hasWorkflow(name: string): boolean {
    return this.workflows.has(name);
  }

  /**
   * Validate workflow agents exist in Fred.
   * Warns about missing agents but does not throw.
   */
  private validateWorkflow(name: string, workflow: Workflow): void {
    // Check default agent exists - warn, don't throw
    if (!this.fred.getAgent(workflow.defaultAgent)) {
      console.warn(
        `[Workflow] Default agent "${workflow.defaultAgent}" not found in workflow "${name}"`
      );
    }

    // Check all workflow agents exist - warn, don't throw
    for (const agentId of workflow.agents) {
      if (!this.fred.getAgent(agentId)) {
        console.warn(
          `[Workflow] Agent "${agentId}" referenced in workflow "${name}" not found`
        );
      }
    }
  }
}
