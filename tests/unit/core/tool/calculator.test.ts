import { describe, test, expect } from 'bun:test';
import { createCalculatorTool } from '../../../../src/core/tool/calculator';

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
    await expect(calculator.execute({ expression: '(2 + 3' })).rejects.toThrow('Unbalanced parentheses');
    await expect(calculator.execute({ expression: '2 + 3)' })).rejects.toThrow('Unbalanced parentheses');
  });

  test('should reject consecutive operators', async () => {
    await expect(calculator.execute({ expression: '2++3' })).rejects.toThrow('consecutive operators');
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
