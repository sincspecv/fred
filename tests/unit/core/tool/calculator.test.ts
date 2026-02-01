import { describe, test, expect } from 'bun:test';
import { createCalculatorTool } from '../../../../packages/core/src/tool/calculator';

describe('Calculator Tool', () => {
  const calculator = createCalculatorTool();

  test('should have correct tool definition', () => {
    expect(calculator.id).toBe('calculator');
    expect(calculator.name).toBe('calculator');
    expect(calculator.description).toContain('arithmetic');
    expect(calculator.schema?.metadata?.type).toBe('object');
    expect(calculator.schema?.metadata?.properties.expression).toBeDefined();
    expect(calculator.schema?.metadata?.required).toContain('expression');
  });

  test('should perform basic addition', async () => {
    const result = await calculator.execute({ expression: '2 + 3' });
    expect(result).toBe('5');
  });

  test('should perform subtraction', async () => {
    const result = await calculator.execute({ expression: '10 - 4' });
    expect(result).toBe('6');
  });

  test('should perform multiplication', async () => {
    const result = await calculator.execute({ expression: '3 * 4' });
    expect(result).toBe('12');
  });

  test('should perform division', async () => {
    const result = await calculator.execute({ expression: '15 / 3' });
    expect(result).toBe('5');
  });

  test('should handle decimal numbers', async () => {
    const result = await calculator.execute({ expression: '2.5 + 3.7' });
    expect(parseFloat(result)).toBeCloseTo(6.2, 5);
  });

  test('should handle parentheses', async () => {
    const result = await calculator.execute({ expression: '(2 + 3) * 4' });
    expect(result).toBe('20');
  });

  test('should handle complex expressions', async () => {
    const result = await calculator.execute({ expression: '2 + 3 * 4' });
    expect(result).toBe('14');
  });

  test('should handle negative numbers', async () => {
    const result = await calculator.execute({ expression: '-5 + 3' });
    expect(result).toBe('-2');
  });

  test('should remove whitespace', async () => {
    const result = await calculator.execute({ expression: '2 + 3 * 4' });
    expect(result).toBe('14');
  });

  test('should return whole numbers without decimals', async () => {
    const result = await calculator.execute({ expression: '10 / 2' });
    expect(result).toBe('5');
  });

  test('should handle division by zero', async () => {
    await expect(calculator.execute({ expression: '10 / 0' })).rejects.toThrow();
  });

  test('should reject invalid characters', async () => {
    await expect(calculator.execute({ expression: '2 + abc' })).rejects.toThrow('invalid characters');
  });

  test('should reject unbalanced parentheses', async () => {
    // Parser detects missing closing paren at EOF
    await expect(calculator.execute({ expression: '(2 + 3' })).rejects.toThrow('Expected RPAREN');
    // Parser detects unexpected closing paren
    await expect(calculator.execute({ expression: '2 + 3)' })).rejects.toThrow('Unexpected token');
  });

  test('should handle consecutive operators as unary', async () => {
    // The parser treats consecutive + as unary operators, which is valid
    // 2++3 is parsed as 2 + (+3) = 5
    const result = await calculator.execute({ expression: '2++3' });
    expect(result).toBe('5');
    // Similarly, 2+-3 is parsed as 2 + (-3) = -1
    const result2 = await calculator.execute({ expression: '2+-3' });
    expect(result2).toBe('-1');
  });

  test('should reject empty expression', async () => {
    await expect(calculator.execute({ expression: '' })).rejects.toThrow();
  });

  test('should reject non-string expression', async () => {
    // @ts-expect-error - Testing invalid input
    await expect(calculator.execute({ expression: null })).rejects.toThrow();
  });

  test('should handle very large numbers', async () => {
    const result = await calculator.execute({ expression: '999999999999999 + 1' });
    expect(result).toBeDefined();
  });

  test('should handle nested parentheses', async () => {
    const result = await calculator.execute({ expression: '((2 + 3) * 4) / 2' });
    expect(result).toBe('10');
  });
});
