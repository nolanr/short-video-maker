import { spawn, spawnSync } from "child_process";
import fs from "fs-extra";
import path from "path";

import { logger } from "../logger";

// Thin wrapper around yt-dlp. Twitch VODs/clips and Kick VODs/clips are all
// supported by yt-dlp's extractors (Kick needs `pip install "yt-dlp[default,curl-cffi]"`).
//
// Two modes:
//  - section: `--download-sections`, so only the needed part of a multi-hour VOD
//    is fetched. yt-dlp hands the network URL to ffmpeg for this, which needs a
//    dynamically linked ffmpeg: the static builds bundled via npm segfault on
//    hostname lookups on many distros. Uses NETWORK_FFMPEG_PATH or `ffmpeg` on PATH.
//  - full: yt-dlp's native downloader fetches the whole source once; cutting
//    happens locally. Fine for clips, slow for long VODs.
export class Downloader {
  private networkFfmpeg: string | null;

  constructor(
    private localFfmpegPath: string,
    private ytDlpPath: string = process.env.YTDLP_PATH || "yt-dlp",
  ) {
    this.networkFfmpeg = Downloader.findNetworkFfmpeg();
    if (!this.networkFfmpeg) {
      logger.warn(
        "No system ffmpeg found: sources will be downloaded in full before cutting. Install ffmpeg (e.g. apt install ffmpeg) or set NETWORK_FFMPEG_PATH to only fetch the needed sections of long VODs.",
      );
    }
  }

  get canDownloadSections() {
    return this.networkFfmpeg !== null;
  }

  private static findNetworkFfmpeg(): string | null {
    if (process.env.NETWORK_FFMPEG_PATH) return process.env.NETWORK_FFMPEG_PATH;
    const which = spawnSync("which", ["ffmpeg"], { encoding: "utf-8" });
    const found = which.status === 0 ? which.stdout.trim() : "";
    return found || null;
  }

  async downloadSection(
    url: string,
    startSec: number,
    endSec: number,
    outputPath: string,
  ): Promise<string> {
    if (!this.networkFfmpeg) {
      throw new Error("Section downloads need a system ffmpeg");
    }
    return this.download(url, outputPath, [
      "--download-sections",
      `*${startSec}-${endSec}`,
      // re-encode around the cut points so the section starts exactly at startSec
      "--force-keyframes-at-cuts",
      "--ffmpeg-location",
      this.networkFfmpeg,
    ]);
  }

  async downloadFull(url: string, outputPath: string): Promise<string> {
    // the local ffmpeg is only used for merging/fixups of files on disk
    return this.download(url, outputPath, [
      "--ffmpeg-location",
      this.localFfmpegPath,
    ]);
  }

  private async download(
    url: string,
    outputPath: string,
    extraArgs: string[],
  ): Promise<string> {
    if (fs.existsSync(outputPath)) {
      logger.debug({ outputPath }, "Using cached download");
      return outputPath;
    }
    const tmpTemplate = `${outputPath}.part-dl.%(ext)s`;
    await this.run([
      url,
      "--no-playlist",
      "--no-progress",
      "-f",
      "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format",
      "mp4",
      ...extraArgs,
      "-o",
      tmpTemplate,
    ]);

    const dir = path.dirname(outputPath);
    const prefix = path.basename(`${outputPath}.part-dl.`);
    const produced = fs
      .readdirSync(dir)
      .find((f) => f.startsWith(prefix) && f.endsWith(".mp4"));
    if (!produced) {
      throw new Error(`yt-dlp finished but no output found for ${url}`);
    }
    fs.moveSync(path.join(dir, produced), outputPath, { overwrite: true });
    return outputPath;
  }

  private run(args: string[]): Promise<void> {
    logger.debug({ args }, "Running yt-dlp");
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytDlpPath, args, {
        stdio: ["ignore", "inherit", "inherit"],
      });
      proc.on("error", (err) =>
        reject(
          new Error(
            `Failed to start yt-dlp (${this.ytDlpPath}): ${err.message}. Install it with "pip install yt-dlp" or set YTDLP_PATH.`,
          ),
        ),
      );
      proc.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`yt-dlp exited with ${code}`)),
      );
    });
  }
}
