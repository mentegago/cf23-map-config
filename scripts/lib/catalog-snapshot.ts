import { isDeepStrictEqual } from "node:util";
import type { CatalogSnapshot } from "../types.ts";

export function preserveUnchangedSnapshot(
  previous: CatalogSnapshot | undefined,
  next: CatalogSnapshot,
): CatalogSnapshot {
  if (!previous) return next;
  const { downloadedAt: _previousTime, ...previousData } = previous;
  const { downloadedAt: _nextTime, ...nextData } = next;
  return isDeepStrictEqual(previousData, nextData) ? previous : next;
}
