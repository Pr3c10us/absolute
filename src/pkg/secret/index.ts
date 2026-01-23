export type GeminiConfiguration = {
    apiKey: string
    model: string
    fastModel: string
    liveModel: string
}

export default class AppSecrets {
    port: number;
    url: string
    batchSize: number
    videoBatchSize: number
    hardwareAccelerator: 'nvidia' | 'apple' | 'none'
    geminiConfiguration: GeminiConfiguration

    constructor() {
        this.port = this.getEnvironmentVariableAsNumber("PORT", 5000);
        this.url = this.getEnvironmentVariableOrFallback("URL", "http://localhost:5000");
        this.batchSize = this.getEnvironmentVariableAsNumber("BATCH_SIZE", 5);
        this.videoBatchSize = this.getEnvironmentVariableAsNumber("VIDEO_BATCH_SIZE", 2);
        this.hardwareAccelerator = this.getEnvironmentVariableOrFallback("HARDWARE_ACCELERATE", "none") as 'nvidia' | 'apple' | 'none';
        this.geminiConfiguration = {
            apiKey: this.getEnvironmentVariable("GEMINI_API_KEY"),
            model: this.getEnvironmentVariableOrFallback("GEMINI_MODEL", "gemini-3-pro-preview"),
            fastModel: this.getEnvironmentVariableOrFallback("GEMINI_FAST_MODEL", "gemini-3-flash-preview"),
            liveModel: this.getEnvironmentVariableOrFallback("GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"),
        }
    }

    getEnvironmentVariable(key: string): string {
        let value = process.env[key]
        if (!value) {
            console.error(`Error: Environment variable "${key}" is not available.`);
            process.exit(1)
        }
        return value
    }


    getEnvironmentVariableOrFallback(key: string, fallback: string): string {
        let value = process.env[key]
        if (!value) {
            return fallback
        }
        return value
    }

    getEnvironmentVariableAsNumber(key: string, fallback: number): number {
        let value = process.env[key];
        if (!value) {
            return fallback;
        }

        const valueNumber = Number(value);
        if (isNaN(valueNumber) || !isFinite(valueNumber)) {
            console.error(`Error: Environment variable "${key}" value "${value}" is not a valid number.`);
            process.exit(1);
        }

        return valueNumber;
    }

    getEnvironmentVariableAsBool(key: string, fallback: boolean): boolean {
        let value = process.env[key];
        if (!value) {
            return fallback;
        }

        const valueLower = value.toLowerCase();
        if (valueLower !== 'true' && valueLower !== 'false') {
            console.error(`Error: Environment variable "${key}" value "${value}" is not a valid boolean. Use "true" or "false".`);
            process.exit(1);
        }

        return valueLower === 'true';
    }

}