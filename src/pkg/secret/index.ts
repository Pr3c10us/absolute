export type PostgresCredentials = {
    user: string
    password: string
    db: string
    host: string
    port: number
    ssl: boolean
}
export type RedisCredentials = {
    user: string
    password: string
    host: string
    port: number
    maxRetriesPerRequest: number | null
}

export type GoogleOAuthCredentials = {
    id: string
    secret: string
    callbackUrl: string
}

export type GeminiConfiguration = {
    apiKey: string
    model: string
    fastModel: string
    audioModel: string
    fastAudioModel: string
    liveModel: string
}

export type SMTPCredentials = {
    fromAddress: string
    host: string
    port: number
    username: string
    password: string
}

export type Urls = {
    verifyEmail: string
    resetPasswordEmail: string
    logo: string
    uiDashboard: string
    uiLogin: string
}

export type StorageCredentials = {
    storageAccountId: string
    storageAccessKeyId: string
    storageSecretAccessKey: string
    storageBucketName: string
    storageBucketPublicDomain: string
}

export default class AppSecrets {
    port: number;
    url: string
    batchSize: number
    hardwareAccelerator: 'nvidia' | 'apple' | 'none'
    geminiConfiguration: GeminiConfiguration

    constructor() {
        this.port = this.getEnvironmentVariableAsNumber("PORT", 5000);
        this.url = this.getEnvironmentVariableOrFallback("URL", "http://localhost:5000");
        this.batchSize = this.getEnvironmentVariableAsNumber("BATCH_SIZE", 5);
        this.hardwareAccelerator = this.getEnvironmentVariableOrFallback("HARDWARE_ACCELERATE", "none") as 'nvidia' | 'apple' | 'none';
        this.geminiConfiguration = {
            apiKey: this.getEnvironmentVariable("GEMINI_API_KEY"),
            model: this.getEnvironmentVariableOrFallback("GEMINI_MODEL", "gemini-3-pro-preview"),
            fastModel: this.getEnvironmentVariableOrFallback("GEMINI_FAST_MODEL", "gemini-3-flash-preview"),
            audioModel: this.getEnvironmentVariableOrFallback("GEMINI_AUDIO_MODEL", "gemini-2.5-pro-preview-tts"),
            fastAudioModel: this.getEnvironmentVariableOrFallback("GEMINI_FAST_AUDIO_MODEL", "gemini-2.5-flash-preview-tts"),
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