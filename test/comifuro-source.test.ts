import { expect, test } from "bun:test";
import { extractSupabaseConnection } from "../scripts/lib/comifuro-source.ts";

test("extracts the public Supabase connection from a catalog bundle", () => {
  expect(extractSupabaseConnection(
    'const client=createClient("https://example-project.supabase.co", "eyJhbGciOiJIUzI1Ni.test.signature")',
  )).toEqual({
    url: "https://example-project.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1Ni.test.signature",
  });
});
