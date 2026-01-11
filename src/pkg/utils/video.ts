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
    const {fps = 30, width = 1920, height = 1080} = options;

    // Create a temporary concat file for FFmpeg
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, {recursive: true});
    }

    const concatFilePath = path.join(tempDir, `concat_${Date.now()}.txt`);

    if (videoData.length === 0) {
        throw new Error("videoData array cannot be empty");
    }

    // Build concat file content
    // Format: file 'path' \n duration X
    const concatContent = videoData
        .map(({panel, duration}) => {
            const absolutePath = path.resolve(panel).replace(/\\/g, "/");
            return `file '${absolutePath}'\nduration ${duration}`;
        })
        .join("\n");

    // Add the last image again (FFmpeg concat demuxer quirk)
    const lastItem = videoData[videoData.length - 1]!;
    const lastImage = path.resolve(lastItem.panel).replace(/\\/g, "/");
    const finalContent = `${concatContent}\nfile '${lastImage}'`;

    fs.writeFileSync(concatFilePath, finalContent);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(concatFilePath)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions([
                `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
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
                // Cleanup temp file
                fs.unlinkSync(concatFilePath);
                console.log("Video created successfully:", outputPath);
                resolve();
            })
            .on("error", (err) => {
                // Cleanup temp file on error
                if (fs.existsSync(concatFilePath)) {
                    fs.unlinkSync(concatFilePath);
                }
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
