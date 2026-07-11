

export function capitalizeFirstLetter(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function camelCaseToKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function kebabCaseToCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/-([a-z])/g, (match, p1) => p1.toUpperCase());
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

export function reverseString(str: string): string {
  return str.split('').reverse().join('');
}

export function countOccurrences(str: string, substring: string): number {
  if (substring.length === 0) return 0;
  const regex = new RegExp(substring, 'g');
  const matches = str.match(regex);
  return matches ? matches.length : 0;
}

export function isPalindrome(str: string): boolean {
  const cleanedStr = str.replace(/[\W_]/g, '').toLowerCase();
  return cleanedStr === cleanedStr.split('').reverse().join('');
}

export function generateRandomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
