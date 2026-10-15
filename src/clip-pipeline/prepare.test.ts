import { test, expect } from "vitest";
import { keepRanges } from "./prepare";

const w = (startMs: number, endMs: number) => ({ text: "x", startMs, endMs });
const trim = { minGapMs: 1000, padMs: 150 };

test("cuts long pauses between words, keeping padding", () => {
  const words = [w(0, 500), w(600, 1000), w(3000, 3500)];
  expect(keepRanges(words, 5000, [], trim)).toEqual([
    [0, 1150],
    [2850, 5000],
  ]);
});

test("leaves short pauses and the segment's own edges alone", () => {
  const words = [w(2000, 2500), w(3200, 3600)];
  expect(keepRanges(words, 8000, [], trim)).toEqual([[0, 8000]]);
});

test("keeps a pause that an overlay is showing over", () => {
  const words = [w(0, 500), w(3000, 3500), w(6000, 6500)];
  expect(keepRanges(words, 7000, [[0, 2500]], trim)).toEqual([
    [0, 3650],
    [5850, 7000],
  ]);
});
