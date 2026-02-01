import { Schema } from 'effect';
import type { Tool, ToolSchemaDefinition } from './tool';

/**
 * Built-in calculator tool for performing basic arithmetic operations
 *
 * This tool safely evaluates mathematical expressions with support for:
 * - Basic arithmetic: addition (+), subtraction (-), multiplication (*), division (/)
 * - Parentheses for grouping
 * - Decimal numbers
 * - Negative numbers
 *
 * Security: Uses a recursive descent parser that only evaluates mathematical
 * operations. No code execution or eval/Function constructor is used.
 */

/**
 * Token types for the lexer
 */
type TokenType = 'NUMBER' | 'PLUS' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'LPAREN' | 'RPAREN' | 'EOF';

interface Token {
  type: TokenType;
  value: number | null;
}

/**
 * Lexer: converts expression string to tokens
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Number (including decimals)
    if (/[0-9]/.test(char) || (char === '.' && i + 1 < expression.length && /[0-9]/.test(expression[i + 1]))) {
      let numStr = '';
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        numStr += expression[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${numStr}`);
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Operators and parentheses
    switch (char) {
      case '+':
        tokens.push({ type: 'PLUS', value: null });
        break;
      case '-':
        tokens.push({ type: 'MINUS', value: null });
        break;
      case '*':
        tokens.push({ type: 'MULTIPLY', value: null });
        break;
      case '/':
        tokens.push({ type: 'DIVIDE', value: null });
        break;
      case '(':
        tokens.push({ type: 'LPAREN', value: null });
        break;
      case ')':
        tokens.push({ type: 'RPAREN', value: null });
        break;
      default:
        throw new Error(`Invalid character: ${char}`);
    }
    i++;
  }

  tokens.push({ type: 'EOF', value: null });
  return tokens;
}

/**
 * Recursive descent parser for arithmetic expressions
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := ('-')? (NUMBER | '(' expression ')')
 */
class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private consume(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type}`);
    }
    this.pos++;
    return token;
  }

  private factor(): number {
    const token = this.current();

    // Handle unary minus
    if (token.type === 'MINUS') {
      this.consume('MINUS');
      return -this.factor();
    }

    // Handle unary plus (just consume it)
    if (token.type === 'PLUS') {
      this.consume('PLUS');
      return this.factor();
    }

    // Handle number
    if (token.type === 'NUMBER') {
      this.consume('NUMBER');
      return token.value!;
    }

    // Handle parenthesized expression
    if (token.type === 'LPAREN') {
      this.consume('LPAREN');
      const result = this.expression();
      this.consume('RPAREN');
      return result;
    }

    throw new Error(`Unexpected token: ${token.type}`);
  }

  private term(): number {
    let result = this.factor();

    while (this.current().type === 'MULTIPLY' || this.current().type === 'DIVIDE') {
      const op = this.current().type;
      this.pos++;

      const right = this.factor();

      if (op === 'MULTIPLY') {
        result *= right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        result /= right;
      }
    }

    return result;
  }

  expression(): number {
    let result = this.term();

    while (this.current().type === 'PLUS' || this.current().type === 'MINUS') {
      const op = this.current().type;
      this.pos++;

      const right = this.term();

      if (op === 'PLUS') {
        result += right;
      } else {
        result -= right;
      }
    }

    return result;
  }

  parse(): number {
    const result = this.expression();

    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token after expression: ${this.current().type}`);
    }

    return result;
  }
}

/**
 * Safely evaluate a mathematical expression using a recursive descent parser
 * No eval() or Function constructor is used.
 */
function safeEvaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
export function createCalculatorTool(): Tool<{ expression: string }, string, never> {
  const schema: ToolSchemaDefinition<{ expression: string }, string, never> = {
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
  };

  return {
    id: 'calculator',
    name: 'calculator',
    description: 'Perform basic arithmetic operations. Use this tool to calculate mathematical expressions. Supports addition (+), subtraction (-), multiplication (*), division (/), parentheses for grouping, and decimal numbers. Example: "2 + 3 * 4" or "(10 - 5) / 2".',
    schema,
    execute: async (args): Promise<string> => {
      const { expression } = args;

      if (!expression || typeof expression !== 'string') {
        throw new Error('Invalid input: expression must be a non-empty string.');
      }

      // Validate characters before parsing
      // Only allow: digits, decimal points, operators, parentheses, and whitespace
      const allowedPattern = /^[0-9+\-*/().\s]+$/;
      if (!allowedPattern.test(expression)) {
        throw new Error('Invalid expression: invalid characters');
      }

      try {
        // Use safe recursive descent parser - no eval() or Function constructor
        const result = safeEvaluate(expression);

        // Validate result is a finite number
        if (!isFinite(result)) {
          throw new Error('Division by zero or invalid result.');
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
          throw new Error(`Could not evaluate "${expression}": ${error.message}`);
        }
        throw new Error(`Could not evaluate "${expression}".`);
      }
    },
    strict: false, // Permissive mode - allows flexibility in expression format
  };
}
