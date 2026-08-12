/**
 * A fixed-capacity history buffer for one time series.
 *
 * Capacity is fixed rather than keyed to the width of the panel that draws it.
 * That is the whole design decision here, and it is worth stating why: sizing
 * the buffer to the panel means widening the terminal permanently discards
 * history you already had, because the wider graph has nowhere to read it from.
 * At 512 doubles a series costs 4 KiB, which is nothing, and resizing becomes a
 * windowing operation over points already held rather than a resampling one.
 *
 * So there is no downsample-on-resize path. There is nothing to downsample.
 */

export class Ring
{
    readonly capacity: number;

    #buffer: Float64Array;
    #length = 0;
    /** index of the next write */
    #head = 0;

    constructor(capacity: number)
    {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError(`Ring capacity must be a positive integer, got ${capacity}`);
        }

        this.capacity = capacity;
        this.#buffer = new Float64Array(capacity);
    }

    get length(): number
    {
        return this.#length;
    }

    /** the value pushed most recently, or undefined while the ring is empty */
    get last(): number | undefined
    {
        if (this.#length === 0) {
            return undefined;
        }

        return this.#buffer[(this.#head - 1 + this.capacity) % this.capacity];
    }

    push(value: number): void
    {
        // a NaN would propagate silently through every max and scale downstream
        // and come out the other side as an unrenderable graph
        this.#buffer[this.#head] = Number.isFinite(value) ? value : 0;
        this.#head = (this.#head + 1) % this.capacity;

        if (this.#length < this.capacity) {
            this.#length++;
        }
    }

    clear(): void
    {
        this.#length = 0;
        this.#head = 0;
    }

    /**
     * Copy the most recent `n` samples into `out`, oldest first.
     *
     * Returns how many were actually written, which is fewer than `n` while the
     * buffer is still filling. The caller is expected to left-pad the graph
     * with that gap rather than treat the shortfall as zeros - a dashboard
     * three seconds old must not draw a flat line claiming the machine was
     * idle for the minute before it started.
     */
    latest(n: number, out: Float64Array): number
    {
        const take = Math.min(n, this.#length, out.length);

        for (let i = 0; i < take; i++) {
            // the offset can go negative, and % in JS keeps the sign of its
            // left operand, so bias it up past zero before wrapping
            const index = (this.#head - take + i + this.capacity * 2) % this.capacity;

            out[i] = this.#buffer[index];
        }

        return take;
    }

    /** the largest of the most recent `n` samples; 0 when there are none */
    max(n: number): number
    {
        const take = Math.min(n, this.#length);
        let result = 0;

        for (let i = 0; i < take; i++) {
            const index = (this.#head - take + i + this.capacity * 2) % this.capacity;
            const value = this.#buffer[index];

            if (value > result) {
                result = value;
            }
        }

        return result;
    }
}
