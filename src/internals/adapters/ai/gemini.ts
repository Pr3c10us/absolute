import type { AIResponse, Voice, File } from "../../domains/ai";
import type AIRepository from "../../domains/ai/repo";
import {
    type GoogleGenAI,
    type GenerateContentResponse,
    createPartFromUri,
    createUserContent,
    type PartListUnion, type PartUnion,
    Modality,
} from "@google/genai";
import type AppSecrets from "../../../pkg/secret";

type ModelPricing = {
    textInputPerMillion: number;
    audioInputPerMillion?: number;
    textOutputPerMillion: number;
    audioOutputPerMillion?: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
    "gemini-3-pro-preview": {
        textInputPerMillion: 2.00,
        textOutputPerMillion: 12.00,
    },
    "gemini-3-flash-preview": {
        textInputPerMillion: 0.50,
        audioInputPerMillion: 1.00,
        textOutputPerMillion: 3.00,
    },
    "gemini-2.5-pro": {
        textInputPerMillion: 1.25,
        textOutputPerMillion: 10.00,
    },
    "gemini-2.5-flash": {
        textInputPerMillion: 0.30,
        audioInputPerMillion: 1.00,
        textOutputPerMillion: 2.50,
    },
    "gemini-2.5-flash-preview-tts": {
        textInputPerMillion: 0.50,
        textOutputPerMillion: 2.50,
        audioOutputPerMillion: 10.00,
    },
    "gemini-2.5-pro-preview-tts": {
        textInputPerMillion: 1.00,
        textOutputPerMillion: 10.00,
        audioOutputPerMillion: 20.00,
    },
    "gemini-2.5-flash-native-audio-preview-12-2025": {
        textInputPerMillion: 0.50,
        audioInputPerMillion: 3.00,
        textOutputPerMillion: 2.00,
        audioOutputPerMillion: 12.00,
    },
    "gemini-2.0-flash": {
        textInputPerMillion: 0.10,
        audioInputPerMillion: 0.70,
        textOutputPerMillion: 0.40,
    },
    "gemini-2.0-flash-lite": {
        textInputPerMillion: 0.075,
        textOutputPerMillion: 0.30,
    },
    "gemini-2.5-flash-lite": {
        textInputPerMillion: 0.10,
        audioInputPerMillion: 0.30,
        textOutputPerMillion: 0.40,
    },
    "gemini-2.5-flash-lite-preview-09-2025": {
        textInputPerMillion: 0.10,
        audioInputPerMillion: 0.30,
        textOutputPerMillion: 0.40,
    },
    "gemini-2.5-flash-preview-09-2025": {
        textInputPerMillion: 0.30,
        audioInputPerMillion: 1.00,
        textOutputPerMillion: 2.50,
    },
};

export default class GeminiAI implements AIRepository {
    constructor(private readonly ai: GoogleGenAI, private readonly appSecrets: AppSecrets) {
    }

    async generateAudio(text: string, voice?: Voice): Promise<AIResponse> {
        const model = this.appSecrets.geminiConfiguration.audioModel;
        const response = await this.ai.models.generateContent({
            model,
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice || "Algieba" },
                    },
                },
            },
        });

        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("Failed to generate audio");

        const dollars = this.calculateCost(model, response, "audio");

        return { response: data, dollars };
    }

    async generateAudioLive(text: string, voice?: Voice, maxRetries: number = 3): Promise<AIResponse> {
        const model = this.appSecrets.geminiConfiguration.liveModel;

        const config = {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voice || "Algieba" },
                },
            },
        };

        let lastError: Error = new Error("Failed to generate audio via Live API");

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await this.attemptLiveAudioGeneration(text, model, config);
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`Live API attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);

                const isLastAttempt = attempt === maxRetries - 1;
                if (isLastAttempt) {
                    throw lastError;
                }

                // Exponential backoff: 1s, 2s, 4s...
                const delay = 1000 * Math.pow(2, attempt);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    private attemptLiveAudioGeneration(
        text: string,
        model: string,
        config: any
    ): Promise<AIResponse> {
        return new Promise((resolve, reject) => {
            const audioChunks: string[] = [];
            let totalInputTokens = 0;
            let totalOutputTokens = 0;
            let liveSession: any = null;
            let isResolved = false;

            this.ai.live.connect({
                model,
                config,
                callbacks: {
                    onopen: () => {
                        console.log("Live API connection opened");
                    },
                    onmessage: (message: any) => {
                        // Handle audio data from model response
                        if (message.serverContent?.modelTurn?.parts) {
                            for (const part of message.serverContent.modelTurn.parts) {
                                if (part.inlineData?.data) {
                                    audioChunks.push(part.inlineData.data);
                                }
                            }
                        }

                        // Collect usage metadata for cost calculation
                        if (message.usageMetadata) {
                            totalInputTokens += message.usageMetadata.promptTokenCount ?? 0;
                            totalOutputTokens += message.usageMetadata.candidatesTokenCount ?? 0;
                        }

                        // Check if turn is complete
                        if (message.serverContent?.turnComplete) {
                            isResolved = true;

                            // Close the session
                            if (liveSession) {
                                liveSession.close();
                            }

                            // Concatenate all audio chunks
                            if (audioChunks.length === 0) {
                                reject(new Error("Failed to generate audio via Live API: No audio data received"));
                                return;
                            }

                            // Decode and concatenate base64 audio chunks
                            const combinedBuffer = Buffer.concat(
                                audioChunks.map(chunk => Buffer.from(chunk, 'base64'))
                            );
                            const combinedBase64 = combinedBuffer.toString('base64');

                            // Calculate cost using the live model pricing
                            const pricing = MODEL_PRICING[model];
                            let dollars = 0;
                            if (pricing) {
                                const inputCost = (totalInputTokens / 1_000_000) * pricing.textInputPerMillion;
                                const outputCostPerMillion = pricing.audioOutputPerMillion ?? pricing.textOutputPerMillion;
                                const outputCost = (totalOutputTokens / 1_000_000) * outputCostPerMillion;
                                dollars = inputCost + outputCost;
                            }

                            resolve({ response: combinedBase64, dollars });
                        }
                    },
                    onerror: (error: any) => {
                        console.error("Live API error:", error.message);
                        if (liveSession) {
                            liveSession.close();
                        }
                        if (!isResolved) {
                            isResolved = true;
                            reject(new Error(`Live API error: ${error.message}`));
                        }
                    },
                    onclose: (event: any) => {
                        const reason = event?.reason;
                        console.log("Live API connection closed:", reason || "(no reason)");

                        // If connection closed with an error reason and we haven't resolved yet, reject
                        if (reason && !isResolved) {
                            isResolved = true;
                            reject(new Error(`Live API connection closed: ${reason}`));
                        }
                    },
                },
            }).then((session: any) => {
                liveSession = session;
                // Send the text as client content and mark turn as complete
                session.sendClientContent({
                    turns: [{ parts: [{ text }] }],
                    turnComplete: true,
                });
            }).catch((error) => {
                if (liveSession) {
                    liveSession.close();
                }
                if (!isResolved) {
                    isResolved = true;
                    reject(error);
                }
            });
        });
    }

    async generateText(prompt: string, files?: File[]): Promise<AIResponse> {
        let uploadedFiles: { uri: string, mimeType: string }[] = []
        if (files && files.length > 0) {
            for await (const file of files) {
                const uploadedFile = await this.ai.files.upload({
                    file: file.path,
                    config: { mimeType: file.mimeType },
                });
                if (!uploadedFile.uri || !uploadedFile.mimeType) {
                    throw new Error("failed to upload file")
                }
                uploadedFiles.push({ uri: uploadedFile.uri, mimeType: uploadedFile.mimeType });
            }
        }

        let parts: PartUnion[] = []
        if (uploadedFiles.length > 0) {
            for await (const uploadedFile of uploadedFiles) {
                const isActive = await this.waitForFileActive(uploadedFile.uri);
                if (!isActive) {
                    throw new Error(`Failed to upload`);
                }
                parts.push(createPartFromUri(uploadedFile.uri, uploadedFile.mimeType))
            }
        }

        parts.push(prompt)

        const model = this.appSecrets.geminiConfiguration.model;
        const response = await this.ai.models.generateContent({
            model,
            contents: createUserContent(parts),
        });

        if (!response.text) throw new Error("Failed to generate text");

        const dollars = this.calculateCost(model, response, "text");

        return { response: response.text, dollars };
    }

    private async waitForFileActive(fileUri: string, maxWaitTime: number = 30000): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const file = await this.getFile(fileUri);
                if (file.state === 'ACTIVE') {
                    return true;
                }
                if (file.state === 'FAILED') {
                    throw new Error(`File processing failed`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Error checking file state:', error);
                return false;
            }
        }
        return false;
    }

    private getFile = async (name: string): Promise<{ state: string; }> => {
        const file = await this.ai.files.get({
            name: name,
        });
        if (!file.state) {
            throw new Error("failed to analyse content")
        }
        return { state: file.state }
    };

    private calculateCost(
        model: string,
        response: GenerateContentResponse,
        type: "audio" | "text" = "text"
    ): number {
        const pricing = MODEL_PRICING[model];
        if (!pricing) {
            console.warn(`No pricing found for model "${model}", returning $0`);
            return 0;
        }

        const usageMetadata = response.usageMetadata;
        if (!usageMetadata) {
            console.warn("No usage metadata in response, returning $0");
            return 0;
        }

        const inputTokens = usageMetadata.promptTokenCount ?? 0;
        const outputTokens = usageMetadata.candidatesTokenCount ?? 0;

        console.log({ inputTokens, outputTokens })

        const inputCostPerMillion = pricing.textInputPerMillion;
        const inputCost = (inputTokens / 1_000_000) * inputCostPerMillion;

        let outputCostPerMillion: number;
        if (type === "audio" && pricing.audioOutputPerMillion) {
            outputCostPerMillion = pricing.audioOutputPerMillion;
        } else {
            outputCostPerMillion = pricing.textOutputPerMillion;
        }
        const outputCost = (outputTokens / 1_000_000) * outputCostPerMillion;

        return inputCost + outputCost;
    }
} 