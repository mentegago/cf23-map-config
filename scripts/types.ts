export interface RawCircle {
  id: number;
  name: string;
  circle_code: string | null;
  circle_type: string | null;
  circle_cut: string | null;
  day: string;
  rating: string | null;
  fandom: string | null;
  other_fandom: string | null;
  sampleworks_images: string[] | null;
  circle_facebook: string | null;
  circle_instagram: string | null;
  circle_twitter: string | null;
  circle_other_socials: string | null;
  marketplace_link: string | null;
  SellsCommision?: boolean;
  SellsComic?: boolean;
  SellsArtbook?: boolean;
  SellsPhotobookGeneral?: boolean;
  SellsPhotobookCosplay?: boolean;
  SellsNovel?: boolean;
  SellsGame?: boolean;
  SellsMusic?: boolean;
  SellsGoods?: boolean;
  SellsHandmadeCrafts?: boolean;
  SellsMagazine?: boolean;
}

export interface CatalogSnapshot {
  schemaVersion: number;
  source: string;
  downloadedAt: string;
  recordCount: number;
  circles: RawCircle[];
}

export interface DirectoryFandom {
  id: number;
  name: string;
  kind: string;
  parentId: number | null;
  aliases: string[];
}

export interface FandomRegistry {
  fandoms: DirectoryFandom[];
  ignored: string[];
}

export interface RegistryMetadata {
  source?: string;
  etag?: string | null;
  lastModified?: string | null;
  schemaVersion?: string | null;
}

export interface EventConfig {
  id: string;
  name: string;
  series: { id: string; name: string };
  edition: number;
  days: Array<{ id: string; label: string }>;
  sourceAttendanceMap: Record<string, string[]>;
}

export type Resolution = {
  input: string;
  status: "matched" | "ignored" | "unknown";
  fandomIds: number[];
};

export interface CanonicalExhibitorInput {
  id: string;
  name: string;
  spaces: Array<{ code: string; type: string | null }>;
  attendanceDayIds: string[];
  contentRating: string | null;
  fandomSourceFields: string[];
  offerings: string[];
  assets: { thumbnail: string | null; gallery: string[] };
  links: Array<{ type: string; url: string }>;
}

export type CanonicalExhibitor = Omit<CanonicalExhibitorInput, "fandomSourceFields"> & {
  fandomIds: number[];
};

export interface EventSourceAdapter<T> {
  toCanonicalInput(record: T, event: EventConfig): CanonicalExhibitorInput;
}
