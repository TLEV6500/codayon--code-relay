/**
 * E2E test helpers for robust DOM waiting and selection.
 *
 * These helpers handle the timing issues that can arise when WebView.evaluate()
 * is called before the page has fully loaded and rendered.
 */

/**
 * Waits for a selector to become available in the DOM (or returns false on timeout).
 *
 * Uses polling instead of a single sleep, which is more robust to varying page load times.
 * Matches the pattern used successfully in connection.test.ts.
 *
 * @param view - The Bun.WebView instance
 * @param selector - The DOM selector to look for (CSS selector string)
 * @param options.timeoutMs - Maximum time to wait (default: 5000ms)
 * @param options.pollIntervalMs - Time between polling attempts (default: 100ms)
 * @returns boolean - true if selector found, false if timeout reached
 */
export async function waitForSelector(
    view: Bun.WebView,
    selector: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<boolean> {
    const { timeoutMs = 5000, pollIntervalMs = 100 } = options ?? {};
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const result = await view.evaluate(
            `(() => !!document.querySelector('${selector}'))()`
        );

        // Check if we got a valid boolean result (not {} or undefined)
        if (result === true || result === false) {
            return result;
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached; return false to indicate selector not found
    return false;
}

/**
 * Evaluates JavaScript in the view and waits for a non-empty result.
 *
 * Useful for getting computed values (like element text content) that need
 * the page to be fully loaded before they're available.
 *
 * @param view - The Bun.WebView instance
 * @param code - JavaScript code to evaluate (must return a non-empty value when ready)
 * @param options.timeoutMs - Maximum time to wait (default: 5000ms)
 * @param options.pollIntervalMs - Time between polling attempts (default: 100ms)
 * @returns any - The result of the JavaScript evaluation, or undefined if timeout
 */
export async function waitForEvaluate<T = any>(
    view: Bun.WebView,
    code: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<T | undefined> {
    const { timeoutMs = 5000, pollIntervalMs = 100 } = options ?? {};
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const result = await view.evaluate(code);
        // Check if we got a valid result (not {} or undefined)
        if (
            result !== undefined &&
            result !== null &&
            (typeof result !== "object" || Object.keys(result).length > 0)
        ) {
            return result as T;
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached
    return undefined;
}
