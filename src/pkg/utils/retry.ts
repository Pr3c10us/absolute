export async function WithRetry<T>(fn: () => Promise<T>, maxAttempts: number = 10, baseDelay: number = 300): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const result = await fn();
            if (attempt > 0) {
                console.log(`[WithRetry] Succeeded on attempt ${attempt + 1}/${maxAttempts}`);
            }
            return result;
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            const isLastAttempt = attempt === maxAttempts - 1;

            if (isLastAttempt) {
                console.error(`[WithRetry] Failed after ${maxAttempts} attempts. Final error:`, lastError.message);
                throw lastError;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(
                `[WithRetry] Attempt ${attempt + 1}/${maxAttempts} failed: ${lastError.message}. ` +
                `Retrying in ${delay}ms...`
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError!;
}