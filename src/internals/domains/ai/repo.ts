import type {AIResponse, Voice, File, UploadedFile} from "."

export default interface AIRepository {
    uploadFiles(files: File[]): Promise<UploadedFile[]>

    generateText(prompt: string,useFastModel: boolean, uploadedFiles?: UploadedFile[], ): Promise<AIResponse>

    generateAudioLive(text: string, voice?: Voice, maxRetries?: number): Promise<AIResponse>
}