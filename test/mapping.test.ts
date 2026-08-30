import { describe, expect, test } from "bun:test";
import { createResolver, normalizeKey, splitTopLevelCommas } from "../scripts/lib/mapping.ts";

describe("OpenFandom matching contract", () => {
  test("normalizes NFKC, surrounding/internal whitespace, and case", () => {
    expect(normalizeKey("  ＨＳＲ   Genshin ")).toBe("hsr genshin");
  });

  test("splits top-level commas but preserves bracketed commas", () => {
    expect(splitTopLevelCommas(" Genshin, Hoyoverse (HSR, ZZZ), [A, B], ")).toEqual([
      "Genshin", "Hoyoverse (HSR, ZZZ)", "[A, B]",
    ]);
  });

  test("resolves aliases many-to-many and prioritizes them over ignored", () => {
    const resolve = createResolver({
      fandoms: [
        { id: 1, name: "One", kind: "franchise", parentId: null, aliases: ["hsr genshin"], alternateNames: [] },
        { id: 2, name: "Two", kind: "franchise", parentId: null, aliases: ["HSR GENSHIN"], alternateNames: [] },
      ],
      ignored: ["hsr genshin", "etc."],
    });
    expect(resolve(" hsr  genshin ")).toEqual([
      { input: "hsr  genshin", status: "matched", fandomIds: [1, 2] },
    ]);
    expect(resolve("etc.")[0]?.status).toBe("ignored");
    expect(resolve("new thing")[0]?.status).toBe("unknown");
  });
});
