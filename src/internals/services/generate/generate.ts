import type AIRepository from "../../domains/ai/repo.ts";
import type AppSecrets from "../../../pkg/secret";
import Generate from "./commands/generate.ts";

export class Commands {
    generate: Generate

    constructor(aiRepository: AIRepository, appSecrets: AppSecrets) {
        this.generate = new Generate(aiRepository,appSecrets)
    }
}

export default class GenerateServices {
    commands: Commands

    constructor(aiRepository: AIRepository, appSecrets: AppSecrets) {
        this.commands = new Commands(aiRepository,appSecrets)
    }
}
