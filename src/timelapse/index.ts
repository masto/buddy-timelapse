import { ChildProcess, spawn } from "child_process";
import { mkdirSync, readdirSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { TimelapseConfig } from "../types/config";

export class TimelapseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelapseError";
  }
}

export class TimelapseCapture {
  private config: TimelapseConfig;
  private captureProcess: ChildProcess | null = null;
  private tempDir: string;
  private isCapturing = false;

  constructor(config: TimelapseConfig) {
    this.config = config;
    this.tempDir = resolve(this.config.tempDirectory);
  }

  async startCapture(resumeIfPossible: boolean = true): Promise<void> {
    if (this.isCapturing) {
      throw new TimelapseError("Capture already in progress");
    }

    // Ensure temp directory exists
    try {
      mkdirSync(this.tempDir, { recursive: true });
    } catch (error) {
      throw new TimelapseError(
        `Failed to create temp directory: ${(error as Error).message}`
      );
    }

    // Check if we have existing frames to resume from
    const existingFrameCount = this.getCapturedFrameCount();
    const isResuming = resumeIfPossible && existingFrameCount > 0;
    let startNumber = 1;

    if (isResuming) {
      // Get the highest frame number and continue from the next one
      startNumber = this.getHighestFrameNumber() + 1;
      console.log(
        `Resuming timelapse capture with ${existingFrameCount} existing frames (starting from frame ${startNumber})`
      );
    } else {
      // Only clear if not resuming
      this.clearTempDirectory();
    }

    // Start ffmpeg capture process
    const outputPattern = join(this.tempDir, "img_%05d.jpg");
    const interval = this.config.captureInterval;

    // ffmpeg command: ffmpeg -rtsp_transport tcp -i {rtspUrl} -vf fps=1/{interval} -start_number {startNumber} -y {outputPattern}
    const ffmpegArgs = [
      "-rtsp_transport",
      "tcp",
      "-i",
      this.config.rtspUrl,
      "-vf",
      `fps=1/${interval}`,
      "-start_number",
      startNumber.toString(),
      "-y",
      outputPattern,
    ];

    this.captureProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.isCapturing = true;

    // Handle process events
    this.captureProcess.on("error", (error) => {
      this.isCapturing = false;
      console.error(`ffmpeg capture error: ${error.message}`);
    });

    this.captureProcess.on("exit", (code, signal) => {
      this.isCapturing = false;
      if (code !== 0 && code !== null) {
        console.error(`ffmpeg capture exited with code ${code}`);
      }
    });

    // Log ffmpeg output for debugging
    if (this.captureProcess.stdout) {
      this.captureProcess.stdout.on("data", (data) => {
        console.log(`ffmpeg stdout: ${data}`);
      });
    }

    if (this.captureProcess.stderr) {
      this.captureProcess.stderr.on("data", (data) => {
        console.log(`ffmpeg stderr: ${data}`);
      });
    }
  }

  async stopCapture(): Promise<void> {
    if (!this.isCapturing || !this.captureProcess) {
      return;
    }

    this.captureProcess.kill("SIGTERM");

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      if (this.captureProcess) {
        this.captureProcess.on("exit", () => {
          this.isCapturing = false;
          this.captureProcess = null;
          resolve();
        });

        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.captureProcess) {
            this.captureProcess.kill("SIGKILL");
          }
          this.isCapturing = false;
          this.captureProcess = null;
          resolve();
        }, 5000);
      } else {
        resolve();
      }
    });
  }

  isCurrentlyCapturing(): boolean {
    return this.isCapturing;
  }

  private clearTempDirectory(): void {
    this.clearFrames();
  }

  /**
   * Clears all captured frames from the temp directory.
   * Call this after video assembly or when resuming state should be cleared.
   */
  clearFrames(): void {
    try {
      const files = readdirSync(this.tempDir);
      let clearedCount = 0;
      for (const file of files) {
        if (file.startsWith("img_") && file.endsWith(".jpg")) {
          unlinkSync(join(this.tempDir, file));
          clearedCount++;
        }
      }
      if (clearedCount > 0) {
        console.log(`Cleared ${clearedCount} frames from temp directory`);
      }
    } catch (error) {
      // Directory might not exist or be empty, ignore
    }
  }

  getCapturedFrameCount(): number {
    try {
      const files = readdirSync(this.tempDir);
      return files.filter(
        (file) => file.startsWith("img_") && file.endsWith(".jpg")
      ).length;
    } catch (error) {
      return 0;
    }
  }

  canResume(): boolean {
    return this.getCapturedFrameCount() > 0;
  }

  getHighestFrameNumber(): number {
    try {
      const files = readdirSync(this.tempDir);
      const jpgFiles = files.filter(
        (file) => file.startsWith("img_") && file.endsWith(".jpg")
      );

      if (jpgFiles.length === 0) {
        return 0;
      }

      // Extract frame numbers and find the highest
      const frameNumbers = jpgFiles.map((file) => {
        const match = file.match(/img_(\d+)\.jpg/);
        return match ? parseInt(match[1], 10) : 0;
      });

      return Math.max(...frameNumbers);
    } catch (error) {
      return 0;
    }
  }

  getFrameInfo(): { count: number; lastFrame: string | null } {
    try {
      const files = readdirSync(this.tempDir);
      const jpgFiles = files.filter(
        (file) => file.startsWith("img_") && file.endsWith(".jpg")
      );

      if (jpgFiles.length === 0) {
        return { count: 0, lastFrame: null };
      }

      // Sort files to find the last frame
      jpgFiles.sort();
      return {
        count: jpgFiles.length,
        lastFrame: jpgFiles[jpgFiles.length - 1],
      };
    } catch (error) {
      return { count: 0, lastFrame: null };
    }
  }
}

export async function assembleVideo(
  config: TimelapseConfig,
  outputPath: string
): Promise<void> {
  const tempDir = resolve(config.tempDirectory);
  const inputPattern = join(tempDir, "img_%05d.jpg");

  // Ensure output directory exists
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
  } catch (error) {
    throw new TimelapseError(
      `Failed to create output directory: ${(error as Error).message}`
    );
  }

  return new Promise((resolve, reject) => {
    // Check if we have any frames to assemble
    const capture = new TimelapseCapture(config);
    const frameCount = capture.getCapturedFrameCount();

    if (frameCount === 0) {
      reject(new TimelapseError("No frames captured to assemble video"));
      return;
    }

    // ffmpeg command: ffmpeg -framerate {framerate} -i {inputPattern} -c:v libx264 -pix_fmt yuv420p {outputPath}
    const ffmpegArgs = [
      "-framerate",
      config.outputFramerate.toString(),
      "-i",
      inputPattern,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y", // Overwrite output file
      outputPath,
    ];

    const assembleProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (assembleProcess.stdout) {
      assembleProcess.stdout.on("data", (data) => {
        stdout += data;
      });
    }

    if (assembleProcess.stderr) {
      assembleProcess.stderr.on("data", (data) => {
        stderr += data;
      });
    }

    assembleProcess.on("error", (error) => {
      reject(new TimelapseError(`ffmpeg assemble error: ${error.message}`));
    });

    assembleProcess.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`Video assembled successfully: ${outputPath}`);
        resolve();
      } else {
        reject(
          new TimelapseError(
            `ffmpeg assemble failed with code ${code}. stderr: ${stderr}`
          )
        );
      }
    });
  });
}
