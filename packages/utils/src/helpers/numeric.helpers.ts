import { isInRange } from '../validation';

export function setInRange(
  value: number,
  min: number,
  max: number,
  inclusive = true,
): number {
  if (isNaN(value)) {
    throw new Error('Value must be a valid number');
  }
  if (isInRange(value, min, max, inclusive)) {
    return value;
  }
  if (inclusive) {
    return Math.min(Math.max(value, min), max);
  } else {
    return Math.max(Math.min(value, max), min);
  }
}

export function roundToDecimalPlaces(
  value: number,
  decimalPlaces: number,
): number {
  if (isNaN(value)) {
    throw new Error('Value must be a valid number');
  }
  const factor = Math.pow(10, decimalPlaces);
  return Math.round(value * factor) / factor;
}

export function formatNumberWithCommas(value: number): string {
  if (isNaN(value)) {
    throw new Error('Value must be a valid number');
  }
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseNumberFromString(str: string): number | null {
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

export function calculatePercentage(part: number, total: number): number {
  if (isNaN(part) || isNaN(total) || total === 0) {
    throw new Error(
      'Part and total must be valid numbers, and total cannot be zero',
    );
  }
  return (part / total) * 100;
}
