import { expect, test } from "bun:test";
import { parseComifuroBoothCodes } from "../scripts/adapters/comifuro.ts";

test("keeps multi-letter block prefixes intact", () => {
  expect(parseComifuroBoothCodes("AA-01/AA-02")).toEqual(["AA-01", "AA-02"]);
  expect(parseComifuroBoothCodes("AB-01")).toEqual(["AB-01"]);
});

test("expands ab suffixes for single-letter blocks", () => {
  expect(parseComifuroBoothCodes("A-02ab")).toEqual(["A-02a", "A-02b"]);
  expect(parseComifuroBoothCodes("A-09ab/A-10ab")).toEqual([
    "A-09a", "A-09b", "A-10a", "A-10b",
  ]);
});

test("removes day annotations from each physical booth", () => {
  expect(parseComifuroBoothCodes("B-04a (SAT)")).toEqual(["B-04a"]);
  expect(parseComifuroBoothCodes("Q-56ab (SUN)/Q-57ab (SUN)")).toEqual([
    "Q-56a", "Q-56b", "Q-57a", "Q-57b",
  ]);
});

test("preserves malformed source values instead of guessing", () => {
  expect(parseComifuroBoothCodes("R=31ab")).toEqual(["R=31ab"]);
});
