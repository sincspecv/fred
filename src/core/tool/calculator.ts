import { Schema } from 'effect';
import { Tool } from './tool';

/**
 * Built-in calculator tool for performing basic arithmetic operations
 * 
 * This tool safely evaluates mathematical expressions with support for:
 * - Basic arithmetic: addition (+), subtraction (-), multiplication (*), division (/)
 * - Parentheses for grouping
 * - Decimal numbers
 * - Negative numbers
 * 
 * Security: Uses a safe evaluation approach that only allows mathematical operations
 * and prevents code injection by restricting to numeric operations only.
 */
export function createCalculatorTool(): Tool {
  return {
    id: 'calculator',
    name: 'calculator',
    description: 'Perform basic arithmetic operations. Use this tool to calculate mathematical expressions. Supports addition (+), subtraction (-), multiplication (*), division (/), parentheses for grouping, and decimal numbers. Example: "2 + 3 * 4" or "(10 - 5) / 2".',
    schema: {
      input: Schema.Struct({
        expression: Schema.String,
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate. Can include numbers, operators (+, -, *, /), parentheses, and decimal points. Example: "2 + 3 * 4" or "(10 - 5) / 2.5"',
          },
        },
        required: ['expression'],
      },
    },
    execute: async (args): Promise<string> => {
      const { expression } = args;

      if (!expression || typeof expression !== 'string') {
        throw new Error('Expression must be a non-empty string');
      }

      // Sanitize: Remove whitespace and validate characters
      const sanitized = expression.replace(/\s+/g, '');
      
      // Only allow: digits, decimal points, operators, parentheses, and negative sign
      // This regex allows: 0-9, ., +, -, *, /, (, )
      const allowedPattern = /^[0-9+\-*/().\s]+$/;
      if (!allowedPattern.test(sanitized)) {
        throw new Error('Expression contains invalid characters. Only numbers, operators (+, -, *, /), parentheses, and decimal points are allowed.');
      }

      // Additional safety: Check for balanced parentheses
      let parenCount = 0;
      for (const char of sanitized) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) {
          throw new Error('Unbalanced parentheses in expression');
        }
      }
      if (parenCount !== 0) {
        throw new Error('Unbalanced parentheses in expression');
      }

      // Additional safety: Prevent multiple consecutive operators (except negative sign at start)
      // This helps prevent malformed expressions like "2++3" or "2**3"
      const operatorPattern = /[+\-*/]{2,}/;
      if (operatorPattern.test(sanitized.replace(/^\-/, ''))) {
        throw new Error('Invalid expression: consecutive operators are not allowed');
      }

      try {
        // Safe evaluation: Use Function constructor with restricted scope
        // This is safer than eval() as it doesn't have access to global scope
        // We only allow basic arithmetic operations
        const result = new Function('return ' + sanitized)();
        
        // Validate result is a number
        if (typeof result !== 'number' || !isFinite(result)) {
          throw new Error('Expression did not evaluate to a valid number');
        }

        // Handle division by zero
        if (!isFinite(result)) {
          throw new Error('Division by zero or invalid operation');
        }

        // Return result as string, handling very large/small numbers
        if (Math.abs(result) > Number.MAX_SAFE_INTEGER) {
          return result.toExponential();
        }

        // Format result: remove unnecessary decimal places for whole numbers
        // But preserve precision for decimal results
        if (result % 1 === 0) {
          return result.toString();
        } else {
          // Limit to reasonable precision (15 decimal places)
          return parseFloat(result.toPrecision(15)).toString();
        }
      } catch (error) {
        if (error instanceof Error) {
          // Re-throw our custom errors
          if (error.message.includes('invalid') || error.message.includes('Invalid')) {
            throw error;
          }
          // For other errors, provide a user-friendly message
          throw new Error(`Could not evaluate expression "${expression}": ${error.message}`);
        }
        throw new Error(`Could not evaluate expression "${expression}"`);
      }
    },
    strict: false, // Permissive mode - allows flexibility in expression format
  };
}
