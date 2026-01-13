import type AppSecrets from "../../../../pkg/secret";
import type AIRepository from "../../../domains/ai/repo.ts";
import path from "path";
import { readdir } from "fs/promises";
import { join } from "path";
import mime from "mime";
import ScriptSplitPrompt from "../../../../pkg/prompts/split.ts";
import SliceComic from "../../../../pkg/utils/extractCBR.ts";
import { WithRetry } from "../../../../pkg/utils/retry.ts";
import type { Voice } from "../../../domains/ai";
import {
    SaveWaveFile
} from "../../../../pkg/utils/audio";
import { CreateVideoFromImages, MergeAudioToVideo, MergeVideos } from "../../../../pkg/utils/video.ts";
import { AudioPrompt } from "../../../../pkg/prompts/live.ts";
import { ScriptPrompt } from "../../../../pkg/prompts/script.ts";

type ScriptSplit = {
    scriptSplit: string;
    panel: number;
}

type Script = {
    script: string;
    page: number;
}

type File = {
    path: string,
    mimeType: string
}

type Response<T> = {
    dollars: number
    data: T
}

export default class Generate {
    constructor(private readonly aiRepository: AIRepository, private readonly appSecrets: AppSecrets) {
    }

    async* handle(files: File[], voice: Voice = "Orus", style: string = "You are a comic book narrator, Read this scriptSplit aloud", abortController?: AbortController): AsyncGenerator<{
        event: string,
        data: any
    }> {
        for await (const file of files) {
            let totalDorris = 0

            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            let dir = path.resolve("results", uniqueSuffix)
            yield* SliceComic(file.path, dir);

            const images = (await readdir(dir, { withFileTypes: true }))
                .filter(d => d.isFile())
                .map(d => ({
                    path: join(dir, d.name),
                    mimeType: mime.getType(d.name) ?? "application/octet-stream"
                }));

            const numberedImages = (await readdir(path.join(dir, "numbers"), { withFileTypes: true }))
                .filter(d => d.isFile())
                .map(d => ({
                    path: join(dir, "numbers", d.name),
                    mimeType: mime.getType(d.name) ?? "application/octet-stream"
                }));

            const { data: scripts, dollars } = await WithRetry(() => this.generateScript(numberedImages))
            totalDorris += dollars
            yield { event: "update", data: { message: "script generated", scripts } }

            let videoPaths: string[] = []
            const BATCH_SIZE = 5;

            // Process scripts in batches of 5
            for (let batchStart = 0; batchStart < scripts.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, scripts.length);
                const batchScripts = scripts.slice(batchStart, batchEnd);

                // Process each script in the batch concurrently
                const batchPromises = batchScripts.map(async (script, batchIndex) => {
                    const originalIndex = batchStart + batchIndex;
                    if (!script) return null;

                    let scriptText = script.script;
                    let image = images[script.page - 1];
                    if (!image) return null;

                    const { data: splitData, dollars: splitDollars } = await WithRetry(() =>
                        this.generateSplits(scriptText, image)
                    );

                    // Generate all audio for this script concurrently
                    const audioPromises = splitData.map((datum, j) => {
                        if (!datum) return Promise.resolve(null);
                        return WithRetry(() => this.generateAudio(voice, style, datum.scriptSplit))
                            .then(result => ({
                                index: j,
                                datum,
                                raw: result.data,
                                dollars: result.dollars
                            }));
                    });

                    const audioResults = await Promise.all(audioPromises);

                    return {
                        originalIndex,
                        script,
                        image,
                        splitData,
                        splitDollars,
                        audioResults
                    };
                });

                const batchResults = await Promise.all(batchPromises);

                // Process results in order and yield events
                for (const result of batchResults) {
                    if (!result) continue;

                    const { originalIndex, script, image, splitData, splitDollars, audioResults } = result;

                    totalDorris += splitDollars;
                    yield { event: "update", data: { message: `page ${script.page} script split`, split: splitData } };

                    let videoData: { panel: string; duration: number }[] = [];
                    const { dir, name } = path.parse(image.path);
                    const audioBuffers: Buffer[] = [];

                    // Process audio results in order
                    for (const audioResult of audioResults) {
                        if (!audioResult) continue;

                        totalDorris += audioResult.dollars;

                        const panelDir = path.resolve(dir, name);
                        const panel = path.join(panelDir, `${audioResult.datum.panel}.jpg`);

                        const audioBuffer = Buffer.from(audioResult.raw, 'base64');
                        audioBuffers.push(audioBuffer);
                        audioBuffers.push(this.generateSilence(1));
                        const duration = this.getBufferDuration(audioBuffer);
                        videoData.push({ panel, duration: duration + 1 });
                        yield { event: "update", data: { message: `audio ${audioResult.index + 1} for page ${script.page} generated` } };
                    }

                    yield { event: "video", data: videoData };
                    const iDir = path.resolve(dir, name);
                    const audioPath = path.join(iDir, `audio.wav`);

                    const mergedAudio = Buffer.concat(audioBuffers);
                    await SaveWaveFile(audioPath, mergedAudio);
                    yield { event: "update", data: { message: `audio for page ${script.page} generated` } };

                    const videoPath = path.join(iDir, `video_no_audio.mp4`);
                    await CreateVideoFromImages(videoData, videoPath, {
                        fps: 30,
                        width: 1920,
                        height: 1080,
                    });
                    const videoAudioPath = path.join(iDir, `video_${originalIndex}.mp4`);
                    await MergeAudioToVideo(
                        videoPath,
                        audioPath,
                        videoAudioPath,
                        {
                            audioFade: true,
                            loop: true,
                            volume: 0.8,
                        }
                    );
                    videoPaths.push(videoAudioPath);
                    yield { event: "update", data: { message: `video for page ${script.page} generated` } };
                }
            }
            const videoPath = path.join(dir, `video.mp4`);
            await MergeVideos(videoPaths, videoPath);
            console.log({ totalDorris })
        }
    }

    private getBufferDuration(
        buffer: Buffer,
        sampleRate = 24000,
        channels = 1,
        bytesPerSample = 2
    ): number {
        return buffer.length / (sampleRate * channels * bytesPerSample);
    }

    private generateSilence(durationSeconds: number, sampleRate = 24000, channels = 1, bytesPerSample = 2): Buffer {
        const numSamples = Math.floor(durationSeconds * sampleRate * channels);
        return Buffer.alloc(numSamples * bytesPerSample, 0);
    }

    async generateSplits(script: string, image: File): Promise<Response<ScriptSplit[]>> {
        let { response, dollars } = await this.aiRepository.generateText(ScriptSplitPrompt(script), [{
            path: image.path,
            mimeType: image.mimeType
        }])
        return { data: this.parseScriptSplits(response), dollars }
    }

    async generateScript(images: File[]): Promise<Response<Script[]>> {
        let { response, dollars } = await this.aiRepository.generateText(ScriptPrompt, images)
        return { data: this.parseScript(response), dollars }
    }

    async generateAudio(voice: Voice, style: string, scriptSplit: string): Promise<Response<string>> {
        let { response, dollars } = await this.aiRepository.generateAudioLive(
            AudioPrompt(scriptSplit, style),
            voice
        )
        return { data: response, dollars }
    }

    parseScriptSplits(raw: string): ScriptSplit[] {
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
            raw.match(/\[\s*{[\s\S]*}\s*\]/);

        if (!jsonMatch) {
            throw new Error("failed to extract script");
        }

        const jsonString = jsonMatch[1]?.trim() || jsonMatch[0];
        const data: unknown = JSON.parse(jsonString);

        if (!Array.isArray(data)) {
            throw new Error("Expected an array");
        }

        return data.map((item, index) => {
            if (
                typeof item !== "object" ||
                item === null ||
                typeof item.scriptSplit !== "string" ||
                typeof item.panel !== "number"
            ) {
                throw new Error(`Invalid item at index ${index}`);
            }
            return item as ScriptSplit;
        });
    }

    parseScript(raw: string): Script[] {
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
            raw.match(/\[\s*{[\s\S]*}\s*\]/);

        if (!jsonMatch) {
            throw new Error("failed to extract script");
        }

        const jsonString = jsonMatch[1]?.trim() || jsonMatch[0];
        const data: unknown = JSON.parse(jsonString);

        if (!Array.isArray(data)) {
            throw new Error("Expected an array");
        }

        return data.map((item, index) => {
            if (
                typeof item !== "object" ||
                item === null ||
                typeof item.script !== "string" ||
                typeof item.page !== "number"
            ) {
                throw new Error(`Invalid item at index ${index}`);
            }
            return item as Script;
        });
    }
}