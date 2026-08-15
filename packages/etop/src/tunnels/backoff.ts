/**
 * How long to wait before trying again.
 *
 * Small enough to be its own file only because it deserves its own test: the
 * two properties here - that it caps, and that it jitters - are both the kind
 * that look right by inspection and are wrong in practice.
 */

export type BackoffOptions = {
    /** the first delay, doubled per attempt */
    baseMs?: number;
    /** never wait longer than this */
    capMs?: number;
    /** test seam; the default is Math.random */
    random?: () => number;
};


export const DEFAULT_BASE_MS = 1000;
export const DEFAULT_CAP_MS = 60_000;

/**
 * How long a connection must hold before the attempt counter resets.
 *
 * Without a floor like this, a tunnel that connects and dies after three
 * seconds looks like a success followed by a first failure, every time, and
 * retries at one-second intervals forever.
 */
export const STABLE_MS = 60_000;


/**
 * The delay before attempt `attempt`, counting from zero.
 *
 * Full jitter - a uniform draw from [0, delay) rather than the delay itself.
 * Two tunnels to the same host drop at the same instant when the link goes, and
 * without jitter they retry in lockstep for as long as the outage lasts,
 * hammering the far end in pairs and recovering together. The expected wait is
 * halved as a side effect, which is a fair price.
 */
export function nextDelay(attempt: number, options: BackoffOptions = {}): number
{
    const base = options.baseMs ?? DEFAULT_BASE_MS;
    const cap = options.capMs ?? DEFAULT_CAP_MS;
    const random = options.random ?? Math.random;

    // 2 ** attempt overflows to Infinity somewhere past attempt 1000, and
    // Infinity * 0.5 is Infinity - so clamp before multiplying, not after
    const ceiling = Math.min(cap, base * 2 ** Math.min(attempt, 30));

    return Math.round(random() * ceiling);
}
