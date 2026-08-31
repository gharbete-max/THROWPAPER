/** Class-name join. Kept dependency-free so every app can use it before the grid exists. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
