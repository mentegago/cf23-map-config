import type { FandomRegistry, Resolution } from "../types.ts";

export function normalizeKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function splitTopLevelCommas(value: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of value) {
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);

    if (character === "," && depth === 0) {
      pieces.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  pieces.push(current.trim());
  return pieces.filter(Boolean);
}

export function createResolver(registry: FandomRegistry): (rawInput: string) => Resolution[] {
  const aliasTargets = new Map<string, number[]>();
  for (const fandom of registry.fandoms) {
    for (const alias of fandom.aliases) {
      const key = normalizeKey(alias);
      const targets = aliasTargets.get(key) ?? [];
      if (!targets.includes(fandom.id)) targets.push(fandom.id);
      aliasTargets.set(key, targets);
    }
  }
  const ignored = new Set(registry.ignored.map(normalizeKey));

  return (rawInput) => splitTopLevelCommas(rawInput).map((input) => {
    const key = normalizeKey(input);
    const fandomIds = aliasTargets.get(key) ?? [];
    if (fandomIds.length) return { input, status: "matched", fandomIds: [...fandomIds] };
    if (ignored.has(key)) return { input, status: "ignored", fandomIds: [] };
    return { input, status: "unknown", fandomIds: [] };
  });
}
