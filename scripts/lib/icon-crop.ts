export interface IconSettings {
  size: number;
  quality: number;
  crop: { centerX: number; centerY: number; shortSideScale: number };
}

export function validateIconSettings(settings: IconSettings) {
  if (!Number.isInteger(settings.size) || settings.size < 1 || settings.size > 512 ||
      !Number.isInteger(settings.quality) || settings.quality < 1 || settings.quality > 100 ||
      !settings.crop || ![settings.crop.centerX, settings.crop.centerY].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
      !Number.isFinite(settings.crop.shortSideScale) || settings.crop.shortSideScale <= 0 || settings.crop.shortSideScale > 1)
    throw Error("Invalid config/creator-icons.json settings");
  return settings;
}

/** Fractions refer to the auto-oriented source, before resizing. */
export function iconCrop(width: number, height: number, crop: IconSettings["crop"]) {
  const side = Math.max(1, Math.round(Math.min(width, height) * crop.shortSideScale));
  return {
    left: Math.max(0, Math.min(width - side, Math.round(width * crop.centerX - side / 2))),
    top: Math.max(0, Math.min(height - side, Math.round(height * crop.centerY - side / 2))),
    width: side,
    height: side,
  };
}
