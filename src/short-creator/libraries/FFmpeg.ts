import ffmpeg from "fluent-ffmpeg";
import { Readable } from "node:stream";
import { logger } from "../../logger";
import type { CropRect, Layout } from "../../components/clips/schema";

export class FFMpeg {
  constructor(private ffmpegPath: string) {}

  // FFMPEG_PATH wins, then ffmpeg-static (6.x), then @ffmpeg-installer (a 2018
  // build that crashes on current Twitch HLS streams).
  static async init(): Promise<FFMpeg> {
    const staticPath = (await import("ffmpeg-static")).default as unknown as
      | string
      | null;
    const ffmpegPath =
      process.env.FFMPEG_PATH ||
      staticPath ||
      (await import("@ffmpeg-installer/ffmpeg")).path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    logger.info({ ffmpegPath }, "FFmpeg path set");
    return new FFMpeg(ffmpegPath);
  }

  async saveNormalizedAudio(
    audio: ArrayBuffer,
    outputPath: string,
  ): Promise<string> {
    logger.debug("Normalizing audio for Whisper");
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .on("end", () => {
          logger.debug("Audio normalization complete");
          resolve(outputPath);
        })
        .on("error", (error: unknown) => {
          logger.error(error, "Error normalizing audio:");
          reject(error);
        })
        .save(outputPath);
    });
  }

  async createMp3DataUri(audio: ArrayBuffer): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return new Promise((resolve, reject) => {
      const chunk: Buffer[] = [];

      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .on("error", (err) => {
          reject(err);
        })
        .pipe()
        .on("data", (data: Buffer) => {
          chunk.push(data);
        })
        .on("end", () => {
          const buffer = Buffer.concat(chunk);
          resolve(`data:audio/mp3;base64,${buffer.toString("base64")}`);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  async saveToMp3(audio: ArrayBuffer, filePath: string): Promise<string> {
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .save(filePath)
        .on("end", () => {
          logger.debug("Audio conversion complete");
          resolve(filePath);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  get path(): string {
    return this.ffmpegPath;
  }

  // Frame-accurate cut, normalized to 1920x1080 (letterboxed) at a constant
  // frame rate so the Remotion layouts can assume fixed source dimensions.
  async cutSegment(
    inputPath: string,
    startSec: number,
    endSec: number,
    outputPath: string,
    fps: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(startSec)
        .duration(endSec - startSec)
        .videoFilters([
          "scale=1920:1080:force_original_aspect_ratio=decrease",
          "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
          "setsar=1",
          `fps=${fps}`,
        ])
        .videoCodec("libx264")
        .outputOptions(["-preset veryfast", "-crf 18", "-pix_fmt yuv420p"])
        .audioCodec("aac")
        .audioChannels(2)
        .audioFrequency(48000)
        .on("end", () => resolve(outputPath))
        .on("error", reject)
        .save(outputPath);
    });
  }

  // Renders a clip-pipeline layout into a width x height video, so the
  // composition draws one full-frame video instead of decoding the source
  // twice per frame (blur background + foreground, or cam + game). Expects
  // the 1920x1080 output of cutSegment.
  async bakeLayout(
    inputPath: string,
    layout: Exclude<Layout, { type: "baked" }>,
    outputPath: string,
    width: number,
    height: number,
  ): Promise<string> {
    const crop = (c: CropRect = { x: 0, y: 0, w: 1, h: 1 }) =>
      `crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y}`;
    // scale to cover w x h, then center-crop to it
    const cover = (w: number, h: number) =>
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    const even = (n: number) => Math.round(n / 2) * 2;

    let graph: string;
    if (layout.type === "fill") {
      graph = `[0:v]${crop(layout.crop)},${cover(width, height)}[v]`;
    } else if (layout.type === "blur") {
      // same look as the Remotion layout: a small blurred, darkened copy scaled up
      const bgW = even(width / 8);
      const bgH = even(height / 8);
      graph =
        `[0:v]${crop(layout.crop)},split[a][b];` +
        `[a]${cover(bgW, bgH)},boxblur=4:1,colorchannelmixer=rr=0.6:gg=0.6:bb=0.6,scale=${width}:${height}[bg];` +
        `[b]scale=${width}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
    } else {
      const camH = even(height * layout.camHeight);
      graph =
        `[0:v]split[a][b];[a]${crop(layout.cam)},${cover(width, camH)}[c];` +
        `[b]${crop(layout.game)},${cover(width, height - camH)}[g];[c][g]vstack[v]`;
    }

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .complexFilter(graph)
        .outputOptions([
          "-map [v]",
          "-map 0:a?",
          "-c:a copy",
          "-preset veryfast",
          "-crf 18",
          "-pix_fmt yuv420p",
        ])
        .videoCodec("libx264")
        .on("end", () => resolve(outputPath))
        .on("error", reject)
        .save(outputPath);
    });
  }

  // 16kHz mono wav, the format whisper.cpp expects
  async extractWav(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .on("end", () => resolve(outputPath))
        .on("error", reject)
        .save(outputPath);
    });
  }
}
