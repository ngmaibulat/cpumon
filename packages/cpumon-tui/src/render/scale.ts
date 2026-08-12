/**
 * Picking the top of a graph's axis.
 *
 * CPU and memory are percentages and need none of this - their axis is 0 to
 * 100 and stays there. Network throughput has no ceiling, so its axis has to
 * follow the data, and following it naively is worse than not scaling at all:
 * an axis recomputed from the window maximum every tick moves under the graph,
 * so a steady stream renders as a flat line while an idle link renders as
 * noise filling the panel. The eye reads shape, and the shape becomes a
 * property of the axis rather than the traffic.
 *
 * Two things fix that. Round the maximum up through a 1-2-5 sequence so there
 * are few possible axes rather than a continuum, and hold whichever one is
 * current until the data leaves it - growing immediately, shrinking only after
 * the peak has stayed down for a while.
 */

/** the mantissas of a 1-2-5 decade sequence: 1, 2, 5, 10, 20, 50, 100... */
const MANTISSAS = [1, 2, 5, 10];


/**
 * The smallest 1-2-5 value that is at least `value`.
 *
 * Zero maps to zero, not to one: an axis of "1 byte per second" over an idle
 * link would draw noise at full height. The caller is expected to treat a zero
 * ceiling as "nothing to draw".
 */
export function niceMax(value: number): number
{
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    const decade = 10 ** Math.floor(Math.log10(value));

    for (const mantissa of MANTISSAS) {
        const candidate = mantissa * decade;

        // guard against the float error in log10/** at exact decade boundaries,
        // where 1000 can land just above its own candidate
        if (value <= candidate * (1 + Number.EPSILON * 8)) {
            return candidate;
        }
    }

    return 10 * decade;
}


export type ScaleOptions = {
    /**
     * How many consecutive ticks the data must fit in a smaller axis before it
     * is allowed to shrink. Growth is never delayed - a spike that does not fit
     * must be drawn now, or the graph is lying about the peak it just missed.
     */
    shrinkAfter?: number;
    /** never scale below this, so a near-idle link does not amplify noise */
    floor?: number;
};


/**
 * An axis ceiling with memory.
 *
 * Stateful on purpose: hysteresis is a fact about the sequence of frames, not
 * about any one of them, so it cannot be recomputed from the current window.
 * One instance per series.
 */
export class AutoScale
{
    #current = 0;
    #belowFor = 0;
    readonly #shrinkAfter: number;
    readonly #floor: number;

    constructor(options: ScaleOptions = {})
    {
        this.#shrinkAfter = options.shrinkAfter ?? 8;
        this.#floor = options.floor ?? 0;
    }

    get current(): number
    {
        return this.#current;
    }

    /** the ceiling to draw against, given the largest value now on screen */
    update(windowMax: number): number
    {
        const wanted = Math.max(niceMax(windowMax), this.#floor);

        if (wanted > this.#current) {
            // grow at once: a clipped spike is a misreport, not a cosmetic issue
            this.#current = wanted;
            this.#belowFor = 0;

            return this.#current;
        }

        if (wanted < this.#current) {
            this.#belowFor++;

            if (this.#belowFor >= this.#shrinkAfter) {
                this.#current = wanted;
                this.#belowFor = 0;
            }

            return this.#current;
        }

        this.#belowFor = 0;

        return this.#current;
    }

    reset(): void
    {
        this.#current = 0;
        this.#belowFor = 0;
    }
}
