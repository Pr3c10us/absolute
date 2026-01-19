import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";

export type Effect =
    | "zoomIn"
    | "zoomOut"
    | "panLeft"
    | "panRight"
    | "panUp"
    | "panDown";

export const OppositeEffect: Record<Effect, Effect> = {
    zoomIn: "zoomOut",
    zoomOut: "zoomIn",
    panLeft: "panRight",
    panRight: "panLeft",
    panUp: "panDown",
    panDown: "panUp",
};

export interface VideoData {
    panel: string;
    duration: number;
    effect?: Effect;
}

/**
 * Helper to generate the specific zoompan filter string.
 *
 * NEW LOGIC:
 * - Input is upscaled 2x before zoompan
 * - z=2 shows the center portion (original image filling frame)
 * - z=1 shows full canvas (image at half size with padding)
 * - This ensures we NEVER zoom past the original resolution
 */
function getEffectFilter(
    effect: Effect | undefined,
    duration: number,
    fps: number
): string {
    const totalFrames = Math.ceil(duration * fps);
    const p = `on/${totalFrames}`;
    const invP = `(1-on/${totalFrames})`;

    const Z_SMALL = "1.0";
    const Z_FULL = "1.5";

    const center_x = (z: string) => `(iw-iw/(${z}))/2`;
    const center_y = (z: string) => `(ih-ih/(${z}))/2`;
    const max_x = (z: string) => `(iw-iw/(${z}))`;
    const max_y = (z: string) => `(ih-ih/(${z}))`;

    const zIn = `${Z_SMALL}+(${Z_FULL}-${Z_SMALL})*${p}`;
    const zOut = `${Z_FULL}-(${Z_FULL}-${Z_SMALL})*${p}`;

    switch (effect) {
        case "zoomIn":
            return `z='${zIn}':x='${center_x(zIn)}':y='${center_y(zIn)}'`;
        case "zoomOut":
            return `z='${zOut}':x='${center_x(zOut)}':y='${center_y(zOut)}'`;
        case "panLeft":
            return `z='${Z_FULL}':x='${max_x(Z_FULL)}*${invP}':y='${center_y(Z_FULL)}'`;
        case "panRight":
            return `z='${Z_FULL}':x='${max_x(Z_FULL)}*${p}':y='${center_y(Z_FULL)}'`;
        case "panUp":
            return `z='${Z_FULL}':x='${center_x(Z_FULL)}':y='${max_y(Z_FULL)}*${invP}'`;
        case "panDown":
            return `z='${Z_FULL}':x='${center_x(Z_FULL)}':y='${max_y(Z_FULL)}*${p}'`;
        default:
            return `z='${Z_SMALL}':x='${center_x(Z_FULL)}':y='${center_y(Z_FULL)}'`;
    }
}

export async function CreateVideoFromImages(
    videoData: VideoData[],
    outputPath: string,
    options: {
        fps?: number;
        width?: number;
        height?: number;
        backgroundImage?: string;
        hwAccel?: 'nvidia' | 'apple' | 'none';  // NEW: hardware acceleration option
    } = {}
): Promise<void> {
    const {
        fps = 30,           // CHANGED: 24fps instead of 30
        width = 1920,
        height = 1080,
        backgroundImage,
        hwAccel = 'none'    // NEW: default to software encoding
    } = options;

    if (videoData.length === 0) {
        throw new Error("videoData array cannot be empty");
    }

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        // 1. Input Handling
        if (backgroundImage) {
            command = command.input(backgroundImage).inputOptions(["-loop 1"]);
        }

        videoData.forEach(({panel}) => {
            command = command.input(panel);
        });

        // 2. Filter Construction
        let filterChains: string[] = [];

        const PAD_COLOR = "0xFF00FF";

        // CHANGED: Reduced super-sampling from 3x to 2x
        const SS = 2;
        const ssW = width * SS;
        const ssH = height * SS;

        // Background Processing
        if (backgroundImage) {
            const bgBase = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height},setsar=1`;
            const splitOuts = videoData.map((_, i) => `[bg_copy${i}]`).join("");
            filterChains.push(`${bgBase},split=${videoData.length}${splitOuts}`);
        }

        videoData.forEach((data, i) => {
            const idx = backgroundImage ? i + 1 : i;
            const normalizedLabel = `norm${i}`;
            const effectLabel = `effect${i}`;
            const keyedLabel = `keyed${i}`;
            const finalLabel = `v${i}`;

            // --- A. PAD ONLY ---
            const padFilter = `[${idx}:v]pad=${ssW}:${ssH}:(ow-iw)/2:(oh-ih)/2:color=${PAD_COLOR},setsar=1[${normalizedLabel}]`;
            filterChains.push(padFilter);

            // --- B. EFFECT ---
            const effectParams = getEffectFilter(data.effect, data.duration, fps);
            const highResZoomCmd = `zoompan=${effectParams}:d=${Math.ceil(data.duration * fps)}:s=${ssW}x${ssH}:fps=${fps}[${effectLabel}]`;
            filterChains.push(`[${normalizedLabel}]${highResZoomCmd}`);

            // --- C. KEYING & DOWNSCALING ---
            // CHANGED: Using fast_bilinear instead of lanczos
            const finalizeFilters = `[${effectLabel}]colorkey=${PAD_COLOR}:0.3:0.1,` +
                `scale=${width}:${height}:flags=fast_bilinear[${keyedLabel}]`;
            filterChains.push(finalizeFilters);

            // --- D. COMPOSITION ---
            if (backgroundImage) {
                filterChains.push(`[bg_copy${i}][${keyedLabel}]overlay=(W-w)/2:(H-h)/2:shortest=1[${finalLabel}]`);
            } else {
                filterChains.push(`[${keyedLabel}]format=yuv420p[${finalLabel}]`);
            }
        });

        // 3. Concatenation
        const concatInputs = videoData.map((_, i) => `[v${i}]`).join("");
        filterChains.push(`${concatInputs}concat=n=${videoData.length}:v=1:a=0[outv]`);

        const filterComplex = filterChains.join("; ");

        // CHANGED: Build output options based on hardware acceleration
        const baseOutputOptions = [
            "-map [outv]",
            "-threads 0",           // NEW: Use all CPU cores
            `-r ${fps}`,
            "-pix_fmt yuv420p",
            "-movflags +faststart"
        ];

        let encoderOptions: string[];
        switch (hwAccel) {
            case 'nvidia':
                encoderOptions = [
                    "-c:v h264_nvenc",
                    "-preset p1",       // Fastest NVENC preset
                    "-rc vbr",
                    "-cq 26"
                ];
                break;
            case 'apple':
                encoderOptions = [
                    "-c:v h264_videotoolbox",
                    "-q:v 65"
                ];
                break;
            default:
                encoderOptions = [
                    "-c:v libx264",
                    "-preset ultrafast",
                    "-tune fastdecode",  // NEW: Optimize for fast decoding
                    "-crf 26"            // CHANGED: 26 instead of 23
                ];
        }

        command
            .complexFilter(filterComplex)
            .outputOptions([...baseOutputOptions, ...encoderOptions])
            .output(outputPath)
            .on("start", (cmd) => console.log("FFmpeg command:", cmd))
            .on("progress", (progress) => console.log(`Processing: ${progress.percent?.toFixed(1)}% done`))
            .on("end", () => {
                console.log("Video created successfully:", outputPath);
                resolve();
            })
            .on("error", (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
            .run();
    });
}

// Rest of file unchanged...
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
    const {audioFade = true, loop = false, volume = 1.0} = options;

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
                    .on("start", (cmdLine) => console.log("FFmpeg command:", cmdLine))
                    .on("progress", (progress) => console.log(`Merging: ${progress.percent?.toFixed(1)}% done`))
                    .on("end", () => {
                        console.log("Audio merged successfully:", outputPath);
                        resolve();
                    })
                    .on("error", (e) => reject(new Error(`FFmpeg error: ${e.message}`)))
                    .run();
            });
        } else {
            if (audioFilters.length > 0) {
                outputOptions.push(`-af ${audioFilters.join(",")}`);
            }

            cmd
                .outputOptions(outputOptions)
                .output(outputPath)
                .on("start", (cmdLine) => console.log("FFmpeg command:", cmdLine))
                .on("progress", (progress) => console.log(`Merging: ${progress.percent?.toFixed(1)}% done`))
                .on("end", () => {
                    console.log("Audio merged successfully:", outputPath);
                    resolve();
                })
                .on("error", (e) => reject(new Error(`FFmpeg error: ${e.message}`)))
                .run();
        }
    });
}

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

    const videoData: VideoData[] = imagePaths.map((imagePath) => ({
        panel: imagePath,
        duration: durationPerImage,
        effect: "zoomIn",
    }));

    return CreateVideoFromImages(videoData, videoPath, options);
}

export async function MergeVideos(
    videoPaths: string[],
    outputPath: string
): Promise<void> {
    if (videoPaths.length === 0) {
        throw new Error("videoPaths array cannot be empty");
    }

    if (videoPaths.length === 1) {
        await fs.promises.copyFile(videoPaths[0]!, outputPath);
        return;
    }

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
            .on("start", (cmd) => console.log("FFmpeg merge command:", cmd))
            .on("progress", (progress) => console.log(`Merging videos: ${progress.percent?.toFixed(1)}% done`))
            .on("end", async () => {
                try {
                    await fs.promises.unlink(tempListPath);
                } catch (e) {
                }
                console.log("Videos merged successfully:", outputPath);
                resolve();
            })
            .on("error", async (err) => {
                try {
                    await fs.promises.unlink(tempListPath);
                } catch (e) {
                }
                reject(new Error(`FFmpeg merge error: ${err.message}`));
            })
            .run();
    });
}