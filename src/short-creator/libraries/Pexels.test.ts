process.env.LOG_LEVEL = "debug";

import nock from "nock";
import { PexelsAPI } from "./Pexels";
import { test, assert, expect, beforeEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { OrientationEnum } from "../../types/shorts";

// a test's unused interceptors would otherwise answer the next test's requests
beforeEach(() => nock.cleanAll());

test("test pexels", async () => {
  const mockResponse = fs.readFileSync(
    path.resolve("__mocks__/pexels-response.json"),
    "utf-8",
  );
  nock("https://api.pexels.com")
    .get(/videos\/search/)
    .reply(200, mockResponse);
  const pexels = new PexelsAPI("asdf");
  const video = await pexels.findVideo(["dog"], 2.4, []);
  console.log(video);
  assert.isObject(video, "Video should be an object");
});

test("should time out", async () => {
  nock("https://api.pexels.com")
    .get(/videos\/search/)
    .delay(1000)
    .times(30)
    .reply(200, {});
  await expect(async () => {
    const pexels = new PexelsAPI("asdf");
    await pexels.findVideo(["dog"], 2.4, [], OrientationEnum.portrait, 100);
  }).rejects.toThrow(
    expect.objectContaining({
      name: "TimeoutError",
    }),
  );
});

test("should retry 3 times", async () => {
  nock("https://api.pexels.com")
    .get(/videos\/search/)
    .delay(1000)
    .times(2)
    .reply(200, {});
  const mockResponse = fs.readFileSync(
    path.resolve("__mocks__/pexels-response.json"),
    "utf-8",
  );
  nock("https://api.pexels.com")
    .get(/videos\/search/)
    .reply(200, mockResponse);

  const pexels = new PexelsAPI("asdf");
  // shorter than the 1 s delay, so the first two attempts time out
  const video = await pexels.findVideo(
    ["dog"],
    2.4,
    [],
    OrientationEnum.portrait,
    500,
  );
  console.log(video);
  assert.isObject(video, "Video should be an object");
});
