/**
 * Workflow types for entry routing
 *
 * Workflows group agents under named entry points, enabling multiple root agents.
 */

import type { RoutingConfig } from '../routing/types';

/**
 * Workflow definition.
 *
 * A workflow represents a named entry point that groups related agents.
 */
export interface Workflow {
  /** Workflow name (unique identifier) */
  name: string;

  /** Default agent to route to when no routing rules match */
  defaultAgent: string;

  /** Agent IDs belonging to this workflow */
  agents: string[];

  /** Optional workflow-specific routing rules */
  routing?: RoutingConfig;
}

/**
 * Workflow configuration from config file.
 *
 * Maps workflow names to their configuration (name is extracted from key).
 */
export interface WorkflowConfig {
  workflows?: Record<string, Omit<Workflow, 'name'>>;
}
