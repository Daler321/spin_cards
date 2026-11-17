import type { ConfigDiffEntry } from '@spincards/shared';

/**
 * Leaf-level differences between two configs. Arrays of objects with `id` (packs, holders) are
 * compared by id, so reordering is not a change; other arrays compare by index.
 */
export function diffConfig(from: unknown, to: unknown, path = ''): ConfigDiffEntry[] {
  if (Array.isArray(from) && Array.isArray(to) && byId(from) && byId(to)) {
    const items: unknown[] = [...(from as unknown[]), ...(to as unknown[])];
    const keys = new Set(items.map((item) => (item as { id: string }).id));
    return [...keys].flatMap((id) =>
      diffConfig(
        from.find((item) => (item as { id: string }).id === id),
        to.find((item) => (item as { id: string }).id === id),
        `${path}[${id}]`,
      ),
    );
  }
  if (isContainer(from) && isContainer(to)) {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    return [...keys].flatMap((key) =>
      diffConfig(
        (from as Record<string, unknown>)[key],
        (to as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ),
    );
  }
  return JSON.stringify(from) === JSON.stringify(to)
    ? []
    : [{ path, from: from ?? null, to: to ?? null }];
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function byId(items: unknown[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => isContainer(item) && typeof (item as { id?: unknown }).id === 'string')
  );
}
