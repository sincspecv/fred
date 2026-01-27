export {
  GlobalVariablesService,
  GlobalVariablesServiceLive,
  type Variable,
  type VariableValue,
  type VariableFactory,
  type VariableState,
} from './service.js';
export { createVariableTools } from './tools.js';
export {
  resolveTemplate,
  resolveTemplateAsync,
  extractVariableNames,
  hasVariables,
  validateTemplate,
} from './template.js';
