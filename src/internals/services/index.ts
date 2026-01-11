import Adapters from "../adapters";
import GenerateServices from "./generate/generate.ts";

export default class Services {
    GenerateServices: GenerateServices

    constructor(adapters: Adapters) {
        this.GenerateServices = new GenerateServices(adapters.ai, adapters.parameters.appSecrets)
    }
}