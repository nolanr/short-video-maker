import express from "express";
import fs from "fs-extra";
import type { AddressInfo } from "net";
import path from "path";

import { AvailableComponentsEnum } from "../components/types";
import { Config } from "../config";
import { logger } from "../logger";
import { FFMpeg } from "../short-creator/libraries/FFmpeg";
import { Remotion } from "../short-creator/libraries/Remotion";
import { Whisper } from "../short-creator/libraries/Whisper";
import { Downloader } from "./Downloader";
import { prepareTimeline } from "./prepare";
import { timelineInput } from "./timeline";

const USAGE = `Usage: clip <timeline.json> [-o out.mp4] [--work <dir>] [--prepare-only]

  -o, --out        output video (default: <timeline name>.mp4 next to the timeline)
  --work           working/cache dir (default: ./clip-work/<timeline name>)
  --prepare-only   download, cut and transcribe, write props.json, skip the render`;

function parseArgs(argv: string[]) {
  const args = { timeline: "", out: "", work: "", prepareOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") args.out = argv[++i];
    else if (a === "--work") args.work = argv[++i];
    else if (a === "--prepare-only") args.prepareOnly = true;
    else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else args.timeline = a;
  }
  if (!args.timeline) {
    console.error(USAGE);
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timelinePath = path.resolve(args.timeline);
  const name = path.basename(timelinePath, path.extname(timelinePath));
  const outPath = path.resolve(
    args.out || path.join(path.dirname(timelinePath), `${name}.mp4`),
  );
  const workDir = path.resolve(args.work || path.join("clip-work", name));
  fs.ensureDirSync(workDir);

  const timeline = timelineInput.parse(fs.readJsonSync(timelinePath));

  // Remotion loads media over http, so serve the work dir while we run
  const app = express();
  app.use(express.static(workDir));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const urlFor = (file: string) =>
    `http://localhost:${port}/` +
    path
      .relative(workDir, file)
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/");

  try {
    const config = new Config();
    const ffmpeg = await FFMpeg.init();
    const whisper = await Whisper.init(config);
    const downloader = new Downloader(ffmpeg.path);

    const props = await prepareTimeline(timeline, {
      ffmpeg,
      whisper,
      downloader,
      workDir,
      urlFor,
      baseDir: path.dirname(timelinePath),
    });
    const propsPath = path.join(workDir, "props.json");
    fs.writeJsonSync(propsPath, props, { spaces: 2 });
    logger.info({ propsPath }, "Timeline prepared");

    if (args.prepareOnly) return;

    const remotion = await Remotion.init(config);
    logger.info({ outPath }, "Rendering");
    await remotion.renderComposition(
      AvailableComponentsEnum.ClipVideo,
      props,
      outPath,
    );
    logger.info({ outPath }, "Done");
  } finally {
    server.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error, "Clip pipeline failed");
  process.exit(1);
});
