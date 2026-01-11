import AppSecrets from "../../pkg/secret";
import {GoogleGenAI} from "@google/genai";
import type AIRepository from "../domains/ai/repo";
import GeminiAI from "./ai/gemini";

export type AdapterParameters = {
    appSecrets: AppSecrets
    geminiClient: GoogleGenAI
}

export default class Adapters {
    ai: AIRepository

    constructor(public parameters: AdapterParameters) {
        this.ai = new GeminiAI(parameters.geminiClient, parameters.appSecrets)
    }
}