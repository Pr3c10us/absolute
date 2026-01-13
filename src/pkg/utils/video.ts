import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";

interface VideoData {
    panel: string;
    duration: number;
}

export async function CreateVideoFromImages(
    videoData: VideoData[],
    outputPath: string,
    options: {
        fps?: number;
        width?: number;
        height?: number;
    } = {}
): Promise<void> {
    const { fps = 30, width = 1920, height = 1080 } = options;

    if (videoData.length === 0) {
        throw new Error("videoData array cannot be empty");
    }

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        // Add each image as a separate input with loop and duration
        videoData.forEach(({ panel, duration }) => {
            command = command
                .input(panel)
                .inputOptions(["-loop 1", `-t ${duration}`]);
        });

        // Build the filter_complex string
        // Scale each input, then concat them all
        const scaleFilters = videoData
            .map((_, i) =>
                `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
                `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
            )
            .join("; ");

        const concatInputs = videoData.map((_, i) => `[v${i}]`).join("");
        const concatFilter = `${concatInputs}concat=n=${videoData.length}:v=1:a=0[outv]`;

        const filterComplex = `${scaleFilters}; ${concatFilter}`;

        command
            .complexFilter(filterComplex)
            .outputOptions([
                "-map [outv]",
                `-r ${fps}`,
                "-pix_fmt yuv420p",
                "-c:v libx264",
                "-preset medium",
                "-crf 23",
            ])
            .output(outputPath)
            .on("start", (cmd) => {
                console.log("FFmpeg command:", cmd);
            })
            .on("progress", (progress) => {
                console.log(`Processing: ${progress.percent?.toFixed(1)}% done`);
            })
            .on("end", () => {
                console.log("Video created successfully:", outputPath);
                resolve();
            })
            .on("error", (err) => {
                reject(new Error(`FFmpeg error: ${err.message}`));
            })
            .run();
    });
}
export async function MergeAudioToVideo(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    options: {
        audioFade?: boolean;
        loop?: boolean;
        volume?: number;
    } = {}
): Promise<void> {
    const { audioFade = true, loop = false, volume = 1.0 } = options;

    return new Promise((resolve, reject) => {
        let cmd = ffmpeg().input(videoPath).input(audioPath);

        const audioFilters: string[] = [];
        if (volume !== 1.0) {
            audioFilters.push(`volume=${volume}`);
        }

        const outputOptions: string[] = [
            "-c:v copy",
            "-c:a aac",
            "-b:a 192k",
            "-shortest",
        ];

        if (loop) {
            cmd = cmd.inputOptions(["-stream_loop -1"]);
        }

        if (audioFade) {
            // Get video duration to apply fade out at the end
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(new Error(`FFprobe error: ${err.message}`));
                    return;
                }

                const duration = metadata.format.duration ?? 0;
                const fadeStart = Math.max(0, duration - 1);
                audioFilters.push(`afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeStart}:d=1`);

                if (audioFilters.length > 0) {
                    outputOptions.push(`-af ${audioFilters.join(",")}`);
                }

                cmd
                    .outputOptions(outputOptions)
                    .output(outputPath)
                    .on("start", (cmdLine) => {
                        console.log("FFmpeg command:", cmdLine);
                    })
                    .on("progress", (progress) => {
                        console.log(`Merging: ${progress.percent?.toFixed(1)}% done`);
                    })
                    .on("end", () => {
                        console.log("Audio merged successfully:", outputPath);
                        resolve();
                    })
                    .on("error", (e) => {
                        reject(new Error(`FFmpeg error: ${e.message}`));
                    })
                    .run();
            });
        } else {
            if (audioFilters.length > 0) {
                outputOptions.push(`-af ${audioFilters.join(",")}`);
            }

            cmd
                .outputOptions(outputOptions)
                .output(outputPath)
                .on("start", (cmdLine) => {
                    console.log("FFmpeg command:", cmdLine);
                })
                .on("progress", (progress) => {
                    console.log(`Merging: ${progress.percent?.toFixed(1)}% done`);
                })
                .on("end", () => {
                    console.log("Audio merged successfully:", outputPath);
                    resolve();
                })
                .on("error", (e) => {
                    reject(new Error(`FFmpeg error: ${e.message}`));
                })
                .run();
        }
    });
}

/**
 * Creates a video slideshow from an array of images.
 * Each image is displayed for the specified duration.
 * 
 * @param imagePaths - Array of paths to the images in order
 * @param videoPath - Output path for the generated video
 * @param durationPerImage - Duration in seconds for each image
 * @param options - Optional settings for fps, width, and height
 */
export async function CreateSlideshow(
    imagePaths: string[],
    videoPath: string,
    durationPerImage: number,
    options: {
        fps?: number;
        width?: number;
        height?: number;
    } = {}
): Promise<void> {
    if (imagePaths.length === 0) {
        throw new Error("imagePaths array cannot be empty");
    }

    if (durationPerImage <= 0) {
        throw new Error("durationPerImage must be greater than 0");
    }

    // Convert to VideoData format expected by CreateVideoFromImages
    const videoData: VideoData[] = imagePaths.map((imagePath) => ({
        panel: imagePath,
        duration: durationPerImage,
    }));

    return CreateVideoFromImages(videoData, videoPath, options);
}

/**
 * Merges multiple video files into a single video.
 * Videos are concatenated in the order they appear in the array.
 * 
 * @param videoPaths - Array of paths to the video files to merge
 * @param outputPath - Output path for the merged video
 */
export async function MergeVideos(
    videoPaths: string[],
    outputPath: string
): Promise<void> {
    if (videoPaths.length === 0) {
        throw new Error("videoPaths array cannot be empty");
    }

    if (videoPaths.length === 1) {
        // Just copy the single video to the output path
        await fs.promises.copyFile(videoPaths[0]!, outputPath);
        return;
    }

    // Create a temporary file list for FFmpeg concat demuxer
    const tempListPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
    const fileListContent = videoPaths
        .map((videoPath) => `file '${videoPath.replace(/'/g, "'\\''")}'`)
        .join("\n");

    await fs.promises.writeFile(tempListPath, fileListContent);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(tempListPath)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions(["-c copy"])
            .output(outputPath)
            .on("start", (cmd) => {
                console.log("FFmpeg merge command:", cmd);
            })
            .on("progress", (progress) => {
                console.log(`Merging videos: ${progress.percent?.toFixed(1)}% done`);
            })
            .on("end", async () => {
                // Clean up the temporary file list
                try {
                    await fs.promises.unlink(tempListPath);
                } catch (e) {
                    console.warn("Failed to delete temp file:", tempListPath);
                }
                console.log("Videos merged successfully:", outputPath);
                resolve();
            })
            .on("error", async (err) => {
                // Clean up the temporary file list on error too
                try {
                    await fs.promises.unlink(tempListPath);
                } catch (e) {
                    // Ignore cleanup errors
                }
                reject(new Error(`FFmpeg merge error: ${err.message}`));
            })
            .run();
    });
}
