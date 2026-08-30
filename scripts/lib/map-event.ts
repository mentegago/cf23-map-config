import { createResolver } from "./mapping.ts";
import type {
  CanonicalExhibitor,
  EventConfig,
  EventSourceAdapter,
  FandomRegistry,
} from "../types.ts";

export interface MappingStats {
  matchedPieces: number;
  ignoredPieces: number;
  unknownPieces: number;
  unknownSourceFields: number;
}

export interface MappedEvent {
  exhibitors: CanonicalExhibitor[];
  unknownSourceFields: string[];
  stats: MappingStats;
}

export function mapEventCatalog<T>(options: {
  records: T[];
  event: EventConfig;
  registry: FandomRegistry;
  adapter: EventSourceAdapter<T>;
}): MappedEvent {
  const resolve = createResolver(options.registry);
  const unknownFields = new Set<string>();
  const stats: MappingStats = {
    matchedPieces: 0,
    ignoredPieces: 0,
    unknownPieces: 0,
    unknownSourceFields: 0,
  };

  const exhibitors = options.records.map((record) => {
    const { fandomSourceFields, ...exhibitor } = options.adapter.toCanonicalInput(record, options.event);
    const fandomIds = new Set<number>();

    for (const rawField of fandomSourceFields) {
      const results = resolve(rawField);
      let fieldHasUnknown = false;
      for (const result of results) {
        if (result.status === "matched") {
          stats.matchedPieces += 1;
          for (const id of result.fandomIds) fandomIds.add(id);
        } else if (result.status === "ignored") {
          stats.ignoredPieces += 1;
        } else {
          stats.unknownPieces += 1;
          fieldHasUnknown = true;
        }
      }
      if (fieldHasUnknown) unknownFields.add(rawField);
    }

    return { ...exhibitor, fandomIds: [...fandomIds].sort((a, b) => a - b) } satisfies CanonicalExhibitor;
  });

  stats.unknownSourceFields = unknownFields.size;
  return {
    exhibitors,
    unknownSourceFields: [...unknownFields].sort((a, b) => a.localeCompare(b)),
    stats,
  };
}
