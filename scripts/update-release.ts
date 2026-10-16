import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function updateRelease(
  previous: Record<string, unknown>,
  inputs: { currentVersion?: string; releaseNotes?: string },
): Record<string, unknown> {
  const next = { ...previous };
  const version = inputs.currentVersion?.trim() ?? "";
  if (version !== "") {
    if (!/^\d+$/.test(version) || !Number.isSafeInteger(Number(version))) {
      throw new Error("current_version must be a non-negative safe integer");
    }
    next.current_version = Number(version);
  }
  if (inputs.releaseNotes?.trim()) next.release_notes = inputs.releaseNotes;
  return next;
}

if (import.meta.main) {
  const file = path.resolve("public/last-updated.json");
  const previous = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const next = updateRelease(previous, {
    currentVersion: process.env.CURRENT_VERSION,
    releaseNotes: process.env.RELEASE_NOTES,
  });
  if (JSON.stringify(previous) === JSON.stringify(next)) {
    console.log("Release metadata unchanged.");
  } else {
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log("Updated release metadata.");
  }
}
