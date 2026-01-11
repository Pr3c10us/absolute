import type {AIResponse, Voice, File} from "."

export default interface AIRepository {
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
     * @param files A list of files to use for the text generation.
     * @returns A Promise that resolves to the generated text.
     */
    generateText(prompt: string, files?: File[]): Promise<AIResponse>
}