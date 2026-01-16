import type {AIResponse, Voice, File, UploadedFile} from "."

export default interface AIRepository {
    /**
     * Upload File to AI people for preprocessing.
     * @param files A list of files to use for the text generation.
     * @returns A Promise that resolves to the uploaded files.
     */
    uploadFiles(files: File[]): Promise<UploadedFile[]>

    /**
     * Generates audio from text using the AI service.
     * @param text The text to generate audio from.
     * @param voice the voice to use for the audio.
     * @returns A Promise that resolves to the generated audio as a base64 string.
     */
    generateAudio(text: string, voice?: Voice): Promise<AIResponse>

    /**
     * Generates text from text using the AI service.
     * @param prompt The text to generate text from.
     * @param useFastModel The faster model should be used.
     * @param uploadedFiles A list of files to use for the text generation.
     * @returns A Promise that resolves to the generated text.
     */
    generateText(prompt: string,useFastModel: boolean, uploadedFiles?: UploadedFile[], ): Promise<AIResponse>

    /**
     * Generates audio using the Live API as a workaround for rate limits on normal audio models.
     * Uses WebSocket-based streaming to connect to the Live API with built-in retry logic.
     * @param text The text to generate audio from.
     * @param voice The voice to use for the audio.
     * @param maxRetries Maximum number of retry attempts (default: 3).
     * @returns A Promise that resolves to the generated audio as a base64 string.
     */
    generateAudioLive(text: string, voice?: Voice, maxRetries?: number): Promise<AIResponse>
}