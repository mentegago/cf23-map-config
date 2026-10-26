import { expect, test } from "bun:test";
import { iconCrop, validateIconSettings } from "../scripts/lib/icon-crop.ts";
import settings from "../config/creator-icons.json";

test("default crop is inside the sample circle-cut frame", () => {
  expect(iconCrop(300, 427, settings.crop)).toEqual({ left: 15, top: 100, width: 270, height: 270 });
});
test("crop stays square and inside small, square, and landscape sources", () => {
  for (const [width, height] of [[1, 1], [80, 80], [400, 100]]) {
    for (const center of [0, 0.5, 1]) {
      const r = iconCrop(width!, height!, { ...settings.crop, centerX: center, centerY: center });
      expect(r.width).toBe(r.height);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(width!);
      expect(r.top + r.height).toBeLessThanOrEqual(height!);
    }
  }
  expect(() => validateIconSettings({ ...settings, crop: { ...settings.crop, shortSideScale: 0 } })).toThrow();
});
