import type AppSecrets from "../../../../pkg/secret";
import type AIRepository from "../../../domains/ai/repo.ts";
import fs from 'fs/promises';
import path from "path";
import { readdir } from "fs/promises";
import { join } from "path";
import mime from "mime";
import NarrationPrompt from "../../../../pkg/prompts/narration.ts";
import SliceComic from "../../../../pkg/utils/extractCBR.ts";
import { WithRetry } from "../../../../pkg/utils/retry.ts";
import type { Voice } from "../../../domains/ai";
import {
    GetWavDurationFromBuffer, MergeWavFiles,
    SaveWaveFile
} from "../../../../pkg/utils/audio";
import { CreateVideoFromImages, MergeAudioToVideo } from "../../../../pkg/utils/video.ts";

type NarrationPanel = {
    narration: string;
    panel: number;
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

    async* handle(files: File[], voice: Voice = "Algieba", style: string = "You are a comic book narrator, Read this narration aloud", abortController?: AbortController): AsyncGenerator<{
        event: string,
        data: any
    }> {
        for await (const file of files) {
            let totalDorris = 0
            // note send events update  as this would be called in a sse handler
            // check if file extension is supported

            // extract based on file extension
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            let dir = path.resolve("results", uniqueSuffix)
            yield* SliceComic(file.path, dir);

            // loop over images in extracted folder
            const images = (await readdir(dir, { withFileTypes: true }))
                .filter(d => d.isFile())
                .map(d => ({
                    path: join(dir, d.name),
                    mimeType: mime.getType(d.name) ?? "application/octet-stream"
                }));


            // generate script for each image
            for (let i = 0; i < images.length; i++) {
                let image = images[i]
                if (!image) continue
                yield { event: "update", data: { message: "generating narration" } }
                const { data, dollars } = await WithRetry(() => this.generateScript(image))
                yield { event: "narrations", data: { narrations: data } }
                totalDorris += dollars
                yield { event: "update", data: { message: "narration generated" } }

                // loop over script narrations eg [{narration: "...", panel: 0]
                let videoData: { panel: string; duration: number }[] = [];
                const { dir, name } = path.parse(image.path);
                const audioBuffers: Buffer[] = [];
                for (let j = 0; j < data.length; j++) {
                    let datum = data[j];
                    if (!datum) continue;

                    const { data: raw, dollars } = await WithRetry(() =>
                        this.generateAudio(voice, style, datum.narration)
                    );
                    totalDorris += dollars;

                    const panelDir = path.resolve(dir, name);
                    const panel = path.join(panelDir, `${datum.panel}.jpg`);

                    const audioBuffer = Buffer.from(raw, 'base64');
                    audioBuffers.push(audioBuffer);
                    audioBuffers.push(this.generateSilence(1));
                    const duration = this.getBufferDuration(audioBuffer);
                    videoData.push({ panel, duration: duration + 1 });
                }
                yield { event: "video", data: videoData }
                const iDir = path.resolve(dir, name);
                const audioPath = path.join(iDir, `.wav`);

                const mergedAudio = Buffer.concat(audioBuffers);
                await SaveWaveFile(audioPath, mergedAudio);

                const videoPath = path.join(iDir, `.mp4`);
                await CreateVideoFromImages(videoData, videoPath, {
                    fps: 30,
                    width: 1920,
                    height: 1080,
                })
                const videoAudioPath = path.join(iDir, `_full.mp4`);
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
                // generate audio for each narration

                // store audio into a folder

                // extract duration along with the panel number store in an array to be used when creating video

                // merge audio into 1 and remove old ones

                // create a slideshow/video using the split panels of the image (stored in a folder with the same name just without the file extension)
                // where each panel is displayed for its accompanying duration before changing to the next

                // merge with audio

                // store
            }

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

    async generateScript(image: File): Promise<Response<NarrationPanel[]>> {
        let { response, dollars } = await this.aiRepository.generateText(NarrationPrompt, [{
            path: image.path,
            mimeType: image.mimeType
        }])
        console.log(response)
        return { data: this.parseNarrationScript(response), dollars }
    }

    async generateAudio(voice: Voice, style: string, narration: string): Promise<Response<string>> {
        let { response, dollars } = await this.aiRepository.generateAudio(
            `${style}: \n${narration}`,
            voice
        )
        return { data: response, dollars }
    }

    parseNarrationScript(raw: string): NarrationPanel[] {
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
                typeof item.narration !== "string" ||
                typeof item.panel !== "number"
            ) {
                throw new Error(`Invalid item at index ${index}`);
            }
            return item as NarrationPanel;
        });
    }
}