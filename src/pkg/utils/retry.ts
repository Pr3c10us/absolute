export async function WithRetry<T>(fn: () => Promise<T>, maxAttempts: number = 3, baseDelay: number = 1000): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            const isLastAttempt = attempt === maxAttempts - 1;

            if (isLastAttempt) throw lastError;

            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError!;
}