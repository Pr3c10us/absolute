import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";

export type Effect =
    | "zoomIn"
    | "zoomOut"
    | "panLeft"
    | "panRight"
    | "panUp"
    | "panDown"
    | "none";


export interface VideoData {
    panel: string;
    duration: number;
    effect?: Effect;
}

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
        hwAccel?: 'nvidia' | 'apple' | 'none';
        transitionDuration?: number;
        transitionEffect?: 'fade' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'dissolve';
    } = {}
): Promise<void> {
    const {
        fps = 30,
        width = 1920,
        height = 1080,
        backgroundImage,
        hwAccel = 'none',
        transitionDuration = 0.5,
        transitionEffect = 'fade'
    } = options;

    if (videoData.length === 0) {
        throw new Error("videoData array cannot be empty");
    }

    // Validate transition duration
    const minDuration = Math.min(...videoData.map(d => d.duration));
    if (transitionDuration >= minDuration) {
        throw new Error(`Transition duration (${transitionDuration}s) must be less than the shortest clip duration (${minDuration}s)`);
    }

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        if (backgroundImage) {
            command = command.input(backgroundImage).inputOptions(["-loop 1"]);
        }

        videoData.forEach(({ panel }) => {
            command = command.input(panel);
        });

        let filterChains: string[] = [];

        const PAD_COLOR = "0xFF00FF";
        const SS = 3;
        const ssW = width * SS;
        const ssH = height * SS;

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

            const isLastClip = i === videoData.length - 1;
            const effectiveDuration = isLastClip ? data.duration : data.duration + transitionDuration;

            const padFilter = `[${idx}:v]scale=${ssW}:${ssH}:force_original_aspect_ratio=decrease,` +
                `pad=${ssW}:${ssH}:(ow-iw)/2:(oh-ih)/2:color=${PAD_COLOR},setsar=1[${normalizedLabel}]`;
            filterChains.push(padFilter);

            const effectParams = getEffectFilter(data.effect, effectiveDuration, fps);
            const highResZoomCmd = `zoompan=${effectParams}:d=${Math.ceil(effectiveDuration * fps)}:s=${ssW}x${ssH}:fps=${fps}[${effectLabel}]`;
            filterChains.push(`[${normalizedLabel}]${highResZoomCmd}`);

            const finalizeFilters = `[${effectLabel}]colorkey=${PAD_COLOR}:0.3:0.1,` +
                `scale=${width}:${height}:flags=fast_bilinear[${keyedLabel}]`;
            filterChains.push(finalizeFilters);

            if (backgroundImage) {
                filterChains.push(`[bg_copy${i}][${keyedLabel}]overlay=(W-w)/2:(H-h)/2:shortest=1[${finalLabel}]`);
            } else {
                filterChains.push(`[${keyedLabel}]format=yuv420p[${finalLabel}]`);
            }
        });

        if (videoData.length === 1) {
            filterChains.push(`[v0]copy[outv]`);
        } else {
            let cumulativeOffset = 0;

            for (let i = 0; i < videoData.length - 1; i++) {
                cumulativeOffset += videoData[i]?.duration!;

                const inputA = i === 0 ? `[v0]` : `[xfade${i - 1}]`;
                const inputB = `[v${i + 1}]`;
                const outputLabel = i === videoData.length - 2 ? `[outv]` : `[xfade${i}]`;

                const offset = cumulativeOffset - transitionDuration;

                filterChains.push(
                    `${inputA}${inputB}xfade=transition=${transitionEffect}:duration=${transitionDuration}:offset=${offset}${outputLabel}`
                );
            }
        }

        const filterComplex = filterChains.join("; ");

        const baseOutputOptions = [
            "-map [outv]",
            "-threads 0",
            `-r ${fps}`,
            "-pix_fmt yuv420p",
            "-movflags +faststart"
        ];

        let encoderOptions: string[];
        switch (hwAccel) {
            case 'nvidia':
                encoderOptions = [
                    "-c:v h264_nvenc",
                    "-preset p1",
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
                    "-tune fastdecode",
                    "-crf 26"
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

function getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(new Error(`Failed to probe ${videoPath}: ${err.message}`));
                return;
            }
            const duration = metadata.format.duration;
            if (typeof duration !== 'number') {
                reject(new Error(`Could not determine duration for ${videoPath}`));
                return;
            }
            resolve(duration);
        });
    });
}

function hasAudioStream(videoPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(new Error(`Failed to probe ${videoPath}: ${err.message}`));
                return;
            }
            const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
            resolve(hasAudio);
        });
    });
}

export async function MergeVideos(
    videoPaths: string[],
    outputPath: string,
    options: {
        transitionDuration?: number;
        transitionEffect?: 'fade' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'dissolve' | 'smoothleft' | 'smoothright' | 'circleopen' | 'circleclose';
        hwAccel?: 'nvidia' | 'apple' | 'none';
    } = {}
): Promise<void> {
    const {
        transitionDuration = 0.5,
        transitionEffect = 'fade',
        hwAccel = 'none'
    } = options;

    if (videoPaths.length === 0) {
        throw new Error("videoPaths array cannot be empty");
    }

    if (videoPaths.length === 1) {
        await fs.promises.copyFile(videoPaths[0]!, outputPath);
        return;
    }

    const durations = await Promise.all(videoPaths.map(getVideoDuration));

    const audioChecks = await Promise.all(videoPaths.map(hasAudioStream));
    const hasAudio = audioChecks.every(has => has);

    const minDuration = Math.min(...durations);
    if (transitionDuration >= minDuration) {
        throw new Error(`Transition duration (${transitionDuration}s) must be less than shortest video (${minDuration}s)`);
    }

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        videoPaths.forEach(videoPath => {
            command = command.input(videoPath);
        });

        const filterChains: string[] = [];
        const numVideos = videoPaths.length;

        let cumulativeDuration = 0;

        for (let i = 0; i < numVideos - 1; i++) {
            cumulativeDuration += durations[i]!;

            const inputA = i === 0 ? `[0:v]` : `[vfade${i - 1}]`;
            const inputB = `[${i + 1}:v]`;
            const outputLabel = i === numVideos - 2 ? `[outv]` : `[vfade${i}]`;

            const offset = cumulativeDuration - transitionDuration * (i + 1);

            filterChains.push(
                `${inputA}${inputB}xfade=transition=${transitionEffect}:duration=${transitionDuration}:offset=${offset.toFixed(3)}${outputLabel}`
            );
        }

        if (hasAudio) {
            const numTransitions = numVideos - 1;
            const totalTrimNeeded = transitionDuration * numTransitions;
            const trimPerClip = totalTrimNeeded / numVideos;

            const audioFade = 0.03; // 30ms fade to prevent clicks

            for (let i = 0; i < numVideos; i++) {
                const audioDur = durations[i]! - trimPerClip;
                filterChains.push(
                    `[${i}:a]atrim=0:${audioDur.toFixed(3)},afade=t=out:st=${(audioDur - audioFade).toFixed(3)}:d=${audioFade}[a${i}]`
                );
            }

            const audioInputs = Array.from({ length: numVideos }, (_, i) => `[a${i}]`).join('');
            filterChains.push(`${audioInputs}concat=n=${numVideos}:v=0:a=1[outa]`);
        }

        const filterComplex = filterChains.join("; ");

        const outputOptions: string[] = [
            "-map [outv]",
            ...(hasAudio ? ["-map [outa]"] : []),
            "-movflags +faststart"
        ];

        let videoEncoderOptions: string[];
        switch (hwAccel) {
            case 'nvidia':
                videoEncoderOptions = ["-c:v h264_nvenc", "-preset p4", "-rc vbr", "-cq 23"];
                break;
            case 'apple':
                videoEncoderOptions = ["-c:v h264_videotoolbox", "-q:v 65"];
                break;
            default:
                videoEncoderOptions = ["-c:v libx264", "-preset fast", "-crf 23"];
        }

        const audioEncoderOptions = hasAudio ? ["-c:a aac", "-b:a 192k"] : [];

        command
            .complexFilter(filterComplex)
            .outputOptions([...outputOptions, ...videoEncoderOptions, ...audioEncoderOptions])
            .output(outputPath)
            .on("start", (cmd) => console.log("FFmpeg merge command:", cmd))
            .on("progress", (progress) => console.log(`Merging videos: ${progress.percent?.toFixed(1)}% done`))
            .on("end", () => {
                console.log("Videos merged successfully:", outputPath);
                resolve();
            })
            .on("error", (err) => {
                reject(new Error(`FFmpeg merge error: ${err.message}`));
            })
            .run();
    });
}