import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = process.cwd();

describe("game-pack boundaries", () => {
  it("contains no production RNG or paytable implementation", () => {
    const files = [
      "src/board/night-drop-board.ts",
      "src/features/night-drop-features.ts",
      "src/outcomes/night-drop-outcomes.ts",
      "src/runtime/night-drop-game.ts",
    ].map((file) => readFileSync(resolve(appRoot, file), "utf8")).join("\n");
    expect(files).not.toMatch(/Math\.random|crypto\.getRandomValues|paytable/i);
    expect(files).toContain("predetermined-demo-outcome");
  });

  it("contains no hardcoded visual colours in CSS", () => {
    const css = readFileSync(resolve(appRoot, "src/style.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
    expect(css).toContain("var(--nd-");
  });

  it("imports shared systems instead of duplicating engine code", () => {
    const runtime = readFileSync(resolve(appRoot, "src/runtime/night-drop-game.ts"), "utf8");
    const features = readFileSync(resolve(appRoot, "src/features/night-drop-features.ts"), "utf8");
    expect(runtime).toContain('from "@hustle/routerun"');
    expect(features).toContain('from "@hustle/core"');
    expect(features).toContain('from "@hustle/routerun"');
  });
});
