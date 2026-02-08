import {
  BUILTIN_TOOL_CAPABILITIES,
  type BuiltinToolCapability,
  type Tool,
  type ToolCapability,
  type ToolCapabilityMetadata,
} from './tool';

const BUILTIN_CAPABILITY_SET = new Set<ToolCapability>(BUILTIN_TOOL_CAPABILITIES);

const CAPABILITY_ORDER: BuiltinToolCapability[] = [
  'read',
  'write',
  'admin',
  'external',
  'expensive',
  'destructive',
];

const READ_HINTS = [
  /(^|[-_\s])(get|list|read|fetch|query|search|view|describe)([-_\s]|$)/,
];

const WRITE_HINTS = [
  /(^|[-_\s])(set|write|create|insert|update|edit|append|save|patch|upload)([-_\s]|$)/,
];

const ADMIN_HINTS = [
  /(^|[-_\s])(admin|config|permission|role|grant|revoke|deploy|manage|system)([-_\s]|$)/,
];

const DESTRUCTIVE_HINTS = [
  /(^|[-_\s])(delete|remove|drop|destroy|truncate|purge|wipe|reset)([-_\s]|$)/,
];

const EXPENSIVE_HINTS = [
  /(^|[-_\s])(batch|analyze|render|train|sync|optimize|compile)([-_\s]|$)/,
];

const EXTERNAL_METADATA_HINTS =
  /\b(https?|url|uri|endpoint|api|webhook|network|remote|request|hostname)\b/i;

export interface ToolCapabilityInference {
  inferred: ToolCapability[];
  manual: ToolCapability[];
  capabilities: ToolCapability[];
}

const toStableCapabilities = (capabilities: readonly ToolCapability[]): ToolCapability[] => {
  const unique = [...new Set(capabilities.map((value) => value.trim()).filter(Boolean))];
  const builtin = CAPABILITY_ORDER.filter((value) => unique.includes(value));
  const custom = unique
    .filter((value) => !BUILTIN_CAPABILITY_SET.has(value))
    .sort((a, b) => a.localeCompare(b));
  return [...builtin, ...custom];
};

const hasPatternHint = (text: string, patterns: RegExp[]): boolean => {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
};

const hasExternalMetadataHint = (tool: Tool): boolean => {
  const metadata = tool.schema?.metadata;
  if (!metadata) {
    return false;
  }

  const metadataBlob = JSON.stringify(metadata);
  return EXTERNAL_METADATA_HINTS.test(metadataBlob);
};

const getManualCapabilities = (tool: Tool): ToolCapability[] => {
  if (tool.capabilityMetadata?.manual) {
    return toStableCapabilities(tool.capabilityMetadata.manual);
  }
  return toStableCapabilities(tool.capabilities ?? []);
};

export const inferToolCapabilities = (tool: Tool): ToolCapabilityInference => {
  const idAndName = `${tool.id} ${tool.name}`.toLowerCase();
  const inferred = new Set<ToolCapability>();

  if (hasPatternHint(idAndName, READ_HINTS)) {
    inferred.add('read');
  }
  if (hasPatternHint(idAndName, WRITE_HINTS)) {
    inferred.add('write');
  }
  if (hasPatternHint(idAndName, ADMIN_HINTS)) {
    inferred.add('admin');
  }
  if (hasPatternHint(idAndName, DESTRUCTIVE_HINTS)) {
    inferred.add('destructive');
  }
  if (hasPatternHint(idAndName, EXPENSIVE_HINTS)) {
    inferred.add('expensive');
  }
  if (hasExternalMetadataHint(tool)) {
    inferred.add('external');
  }

  const inferredCapabilities = toStableCapabilities([...inferred]);
  const manualCapabilities = getManualCapabilities(tool);

  return {
    inferred: inferredCapabilities,
    manual: manualCapabilities,
    capabilities: toStableCapabilities([...inferredCapabilities, ...manualCapabilities]),
  };
};

export const withInferredCapabilities = <T extends Tool>(tool: T): T => {
  const inferred = inferToolCapabilities(tool);
  const capabilityMetadata: ToolCapabilityMetadata = {
    inferred: inferred.inferred,
    manual: inferred.manual,
  };

  return {
    ...tool,
    capabilities: inferred.capabilities,
    capabilityMetadata,
  };
};
