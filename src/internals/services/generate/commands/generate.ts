import type AppSecrets from "../../../../pkg/secret";
import type AIRepository from "../../../domains/ai/repo.ts";
import path from "path";
import {readdir} from "fs/promises";
import {join} from "path";
import mime from "mime";
import {SplitScriptPrompt} from "../../../../pkg/prompts/split.ts";
import SliceComic from "../../../../pkg/utils/extractCBR.ts";
import {WithRetry} from "../../../../pkg/utils/retry.ts";
import type {UploadedFile, Voice} from "../../../domains/ai";
import {
    SaveWaveFile
} from "../../../../pkg/utils/audio";
import {
    CreateVideoFromImages,
    MergeAudioToVideo,
    MergeVideos,
    type Effect,
    OppositeEffect
} from "../../../../pkg/utils/video.ts";
import {AudioPrompt} from "../../../../pkg/prompts/live.ts";
import {ScriptPrompt} from "../../../../pkg/prompts/script.ts";

type ScriptPagePanel = {
    page: number;
    script: string;
    panel: number;
    effect: Effect;
}

type PageGroup = {
    page: number;
    panels: {
        script: string;
        panel: number;
        effect: Effect;
    }[];
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

    async* handle(files: File[], voice: Voice = "Zephyr", style: string,context: string, abortController?: AbortController): AsyncGenerator<{
        event: string,
        data: any
    }> {
        for await (const file of files) {
            let totalDorris = 0
            let lastScriptSplit = "";

            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            let dir = path.resolve("results", uniqueSuffix)
            yield* SliceComic(file.path, dir);

            const images = (await readdir(dir, {withFileTypes: true}))
                .filter(d => d.isFile() && !d.name.includes("cover_blur"))
                .map(d => ({
                    path: join(dir, d.name),
                    mimeType: mime.getType(d.name) ?? "application/octet-stream"
                }))
                .filter(img => img.mimeType.startsWith("image/"));

            yield {event: "update", data: {message: "uploading images for processing"}}
            const uploadedNumberImages = await WithRetry(() => this.aiRepository.uploadFiles(images))

            yield {event: "update", data: {message: "generating script"}}
            const {
                response: script,
                dollars: scriptDorris
            } = await WithRetry(() => this.aiRepository.generateText(ScriptPrompt(context), false, uploadedNumberImages))
            totalDorris += scriptDorris
            yield {event: "script", data: {script}}

            yield {event: "update", data: {message: "splitting generated script"}}
            const {data: pagePanels, dollars: splitDollars} = await WithRetry(() =>
                this.generatePagePanelMapping(script, uploadedNumberImages)
            )
            totalDorris += splitDollars
            const pageGroups = this.groupByPage(pagePanels)
            yield {event: "split", data: {splits: pageGroups}}

            let videoPaths: string[] = []
            const BATCH_SIZE = 3;

            yield {event: "update", data: {message: "converting splits to speech"}}
            for (let batchStart = 0; batchStart < pageGroups.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, pageGroups.length);
                const batchGroups = pageGroups.slice(batchStart, batchEnd);

                const batchStartingContext = lastScriptSplit;

                const batchPromises = batchGroups.map(async (pageGroup, batchIndex) => {
                    const originalIndex = batchStart + batchIndex;
                    if (!pageGroup) return null;

                    let image = images[pageGroup.page - 1];
                    if (!image) return null;

                    const {dir: imageDir, name: imageName} = path.parse(image.path);
                    const panelDir = path.resolve(imageDir, imageName);

                    const panelCount = await this.countPanelsInFolder(panelDir);

                    const boundedPanels = this.enforcePanelBounds(pageGroup.panels, panelCount, pageGroup.page);

                    const splitData = this.enforceEffectAlternation(boundedPanels);

                    const pageStartingContext = batchIndex === 0 ? batchStartingContext : "";

                    const audioPromises = splitData.map((datum, j) => {
                        if (!datum) return Promise.resolve(null);

                        const previousScript = j > 0
                            ? splitData[j - 1]?.script ?? ""
                            : pageStartingContext;

                        return WithRetry(() => this.generateAudio(voice, style, datum.script, previousScript))
                            .then(result => ({
                                index: j,
                                datum,
                                raw: result.data,
                                dollars: result.dollars
                            }));
                    });

                    const audioResults = await Promise.all(audioPromises);

                    const lastSplit = splitData.length > 0
                        ? splitData[splitData.length - 1]?.script ?? ""
                        : "";

                    return {
                        originalIndex,
                        pageGroup,
                        image,
                        splitData,
                        audioResults,
                        lastSplit
                    };
                });

                const batchResults = await Promise.all(batchPromises);

                // Prepare video processing data for each result
                const videoProcessingTasks: {
                    originalIndex: number;
                    pageGroup: PageGroup;
                    splitData: { script: string; panel: number; effect: Effect }[];
                    videoData: { panel: string; duration: number; effect: Effect }[];
                    audioPath: string;
                    videoPath: string;
                    videoAudioPath: string;
                    coverBlurPath: string;
                    totalDollars: number;
                }[] = [];

                for (const result of batchResults) {
                    if (!result) continue;

                    const {originalIndex, pageGroup, image, splitData, audioResults, lastSplit} = result;

                    if (lastSplit) {
                        lastScriptSplit = lastSplit;
                    }

                    let videoData: { panel: string; duration: number; effect: Effect }[] = [];
                    const {dir, name} = path.parse(image.path);
                    const audioBuffers: Buffer[] = [];
                    let taskDollars = 0;

                    for (const audioResult of audioResults) {
                        if (!audioResult) continue;

                        taskDollars += audioResult.dollars;

                        const panelDir = path.resolve(dir, name);
                        const panel = path.join(panelDir, `${audioResult.datum.panel}.jpg`);

                        const audioBuffer = Buffer.from(audioResult.raw, 'base64');
                        audioBuffers.push(audioBuffer);
                        audioBuffers.push(this.generateSilence(1));
                        const duration = this.getBufferDuration(audioBuffer);
                        videoData.push({panel, duration: duration + 1, effect: audioResult.datum.effect});
                    }

                    const iDir = path.resolve(dir, name);
                    const audioPath = path.join(iDir, `audio.wav`);
                    const mergedAudio = Buffer.concat(audioBuffers);
                    await SaveWaveFile(audioPath, mergedAudio);

                    const videoPath = path.join(iDir, `video_no_audio.mp4`);
                    const coverBlurPath = path.join(dir, 'cover_blur.jpg');
                    const videoAudioPath = path.join(iDir, `video_${originalIndex}.mp4`);

                    videoProcessingTasks.push({
                        originalIndex,
                        pageGroup,
                        splitData,
                        videoData,
                        audioPath,
                        videoPath,
                        videoAudioPath,
                        coverBlurPath,
                        totalDollars: taskDollars,
                    });
                }

                // Run all video creation and audio merging in parallel
                const videoPromises = videoProcessingTasks.map(async (task) => {
                    await CreateVideoFromImages(task.videoData, task.videoPath, {
                        fps: 30,
                        width: 1920,
                        height: 1080,
                        backgroundImage: task.coverBlurPath,
                    });
                    await MergeAudioToVideo(
                        task.videoPath,
                        task.audioPath,
                        task.videoAudioPath,
                        {
                            audioFade: true,
                            loop: true,
                            volume: 0.8,
                        }
                    );
                    return task;
                });

                const completedTasks = await Promise.all(videoPromises);

                for (const task of completedTasks) {
                    totalDorris += task.totalDollars;
                    yield {event: "update", data: {message: `speech generated for page  ${task.pageGroup.page}`}};
                    yield {event: "update", data: {message: `video created for page  ${task.pageGroup.page}`}};
                    videoPaths.push(task.videoAudioPath);
                }
            }
            yield {event: "update", data: {message: `merging videos`}};
            const videoPath = path.join(dir, `video.mp4`);
            await MergeVideos(videoPaths, videoPath);
            yield {event: "update", data: {message: `complete`, totalDorris, video: path.join("results", uniqueSuffix, "video.mp4")}};
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

    private async countPanelsInFolder(panelDir: string): Promise<number> {
        try {
            const files = await readdir(panelDir, {withFileTypes: true});
            const panelFiles = files.filter(f =>
                f.isFile() &&
                /^\d+\.(jpg|jpeg|png|webp)$/i.test(f.name)
            );
            return panelFiles.length;
        } catch (error) {
            console.error(`[Panel Count Error] Failed to read panel directory: ${panelDir}`, error);
            return 1;
        }
    }

    private enforcePanelBounds(
        panels: { script: string; panel: number; effect: Effect }[],
        maxPanels: number,
        pageNumber: number
    ): { script: string; panel: number; effect: Effect }[] {
        if (!panels || panels.length === 0) return [];
        if (maxPanels < 1) maxPanels = 1;

        return panels.map((panel, index) => {
            if (panel.panel > maxPanels) {
                console.warn(
                    `[Panel Out of Bounds] Page ${pageNumber}, Index ${index}: ` +
                    `Model selected panel ${panel.panel}, but only ${maxPanels} panel(s) exist. ` +
                    `Clamping to panel ${maxPanels}.`
                );
                return {
                    ...panel,
                    panel: maxPanels
                };
            }

            if (panel.panel < 1) {
                console.warn(
                    `[Panel Out of Bounds] Page ${pageNumber}, Index ${index}: ` +
                    `Model selected panel ${panel.panel}, which is invalid. ` +
                    `Clamping to panel 1.`
                );
                return {
                    ...panel,
                    panel: 1
                };
            }

            return panel;
        });
    }

    async generatePagePanelMapping(script: string, images: UploadedFile[]): Promise<Response<ScriptPagePanel[]>> {
        let {response, dollars} = await this.aiRepository.generateText(
            SplitScriptPrompt(script),
            false,
            images
        )
        return {data: this.parseScriptPagePanels(response), dollars}
    }

    async generateAudio(voice: Voice, style: string, scriptSplit: string, previousScript?: string): Promise<Response<string>> {
        let {response, dollars} = await this.aiRepository.generateAudioLive(
            AudioPrompt(scriptSplit, style, previousScript),
            voice
        )
        return {data: response, dollars}
    }

    private groupByPage(pagePanels: ScriptPagePanel[]): PageGroup[] {
        const pageMap = new Map<number, PageGroup>();

        for (const item of pagePanels) {
            if (!pageMap.has(item.page)) {
                pageMap.set(item.page, {
                    page: item.page,
                    panels: []
                });
            }
            pageMap.get(item.page)!.panels.push({
                script: item.script,
                panel: item.panel,
                effect: item.effect
            });
        }

        return Array.from(pageMap.values()).sort((a, b) => a.page - b.page);
    }

    private enforceEffectAlternation(panels: { script: string; panel: number; effect: Effect }[]): {
        script: string;
        panel: number;
        effect: Effect
    }[] {
        if (!panels || panels.length === 0) return [];

        const firstPanel = panels[0];
        if (!firstPanel) return [];

        const result: { script: string; panel: number; effect: Effect }[] = [{
            script: firstPanel.script,
            panel: firstPanel.panel,
            effect: firstPanel.effect,
        }];

        for (let i = 1; i < panels.length; i++) {
            const current = panels[i];
            const previous = result[i - 1];

            if (!current || !previous) continue;

            if (current.panel === previous.panel) {
                result.push({
                    script: current.script,
                    panel: current.panel,
                    effect: OppositeEffect[previous.effect],
                });
            } else {
                result.push({
                    script: current.script,
                    panel: current.panel,
                    effect: current.effect,
                });
            }
        }
        return result;
    }

    parseScriptPagePanels(raw: string): ScriptPagePanel[] {
        const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) ||
            raw.match(/\[\s*{[\s\S]*}\s*\]/);

        if (!jsonMatch) {
            throw new Error("failed to extract script page panels");
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
                typeof item.page !== "number" ||
                typeof item.script !== "string" ||
                typeof item.panel !== "number" ||
                typeof item.effect !== "string"
            ) {
                throw new Error(`Invalid item at index ${index}`);
            }
            return item as ScriptPagePanel;
        });
    }
}