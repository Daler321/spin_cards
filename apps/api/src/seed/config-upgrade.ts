/**
 * Fills keys that a newer config schema added (from the defaults) without touching existing values.
 * Arrays of objects with `id` (packs, holders) are merged per id; other arrays are kept as they are.
 */
export function fillMissing(current: unknown, defaults: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(defaults)) {
    return current.map((item: unknown) => {
      const id = idOf(item);
      const match: unknown =
        id === undefined ? undefined : defaults.find((d: unknown) => idOf(d) === id);
      return match === undefined ? item : fillMissing(item, match);
    });
  }
  if (isRecord(current) && isRecord(defaults)) {
    const result: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(defaults)) {
      result[key] = key in current ? fillMissing(current[key], value) : value;
    }
    return result;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idOf(value: unknown): unknown {
  return isRecord(value) ? value.id : undefined;
}
