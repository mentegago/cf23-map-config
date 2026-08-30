export function nextCreatorDataVersion(options: {
  previousFingerprint?: string;
  nextFingerprint: string;
  previousVersion: number;
}): number {
  if (!Number.isSafeInteger(options.previousVersion) || options.previousVersion < 0) {
    throw new Error("creator_data_version must be a non-negative safe integer");
  }
  return options.previousFingerprint && options.previousFingerprint !== options.nextFingerprint
    ? options.previousVersion + 1
    : options.previousVersion;
}
