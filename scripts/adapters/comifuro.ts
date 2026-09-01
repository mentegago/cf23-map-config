import type { EventConfig, EventSourceAdapter, RawCircle } from "../types.ts";

export function parseComifuroBoothCodes(value: string | null): string[] {
  return String(value ?? "").split("/").flatMap((rawCode) => {
    const code = rawCode.trim().replace(/\s+\((?:SAT|SUN)\)\s*$/i, "");
    if (!code) return [];

    // Single-letter blocks use a/b half-booth suffixes. `ab` occupies both.
    // Multi-letter prefixes such as AB are block names, not half-booth suffixes.
    const combinedHalfBooth = code.match(/^([A-Z]-\d+)ab$/i);
    return combinedHalfBooth?.[1]
      ? [`${combinedHalfBooth[1]}a`, `${combinedHalfBooth[1]}b`]
      : [code];
  });
}

const offeringFields = {
  SellsCommision: "commission",
  SellsComic: "comic",
  SellsArtbook: "artbook",
  SellsPhotobookGeneral: "photobook_general",
  SellsPhotobookCosplay: "photobook_cosplay",
  SellsNovel: "novel",
  SellsGame: "game",
  SellsMusic: "music",
  SellsGoods: "goods",
  SellsHandmadeCrafts: "handmade_crafts",
  SellsMagazine: "magazine",
} as const satisfies Partial<Record<keyof RawCircle, string>>;

export const comifuroAdapter: EventSourceAdapter<RawCircle> = {
  toCanonicalInput(circle, event: EventConfig) {
    const links = Object.entries({
      facebook: circle.circle_facebook,
      instagram: circle.circle_instagram,
      twitter: circle.circle_twitter,
      other: circle.circle_other_socials,
      marketplace: circle.marketplace_link,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([type, url]) => ({ type, url }));

    return {
      id: String(circle.id),
      name: circle.name,
      spaces: parseComifuroBoothCodes(circle.circle_code).map((code) => ({
        code,
        type: circle.circle_type ?? null,
      })),
      attendanceDates: event.sourceAttendanceMap[circle.day] ?? [],
      contentRating: circle.rating ?? null,
      fandomSourceFields: [circle.fandom, circle.other_fandom]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      offerings: Object.entries(offeringFields)
        .filter(([field]) => Boolean(circle[field as keyof RawCircle]))
        .map(([, name]) => name),
      assets: {
        thumbnail: circle.circle_cut,
        gallery: Array.isArray(circle.sampleworks_images) ? circle.sampleworks_images : [],
      },
      links,
    };
  },
};
