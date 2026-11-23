/**
 * T-bar driving for PixelHue switchers.
 *
 * Device protocol (undocumented, verified on a Q8, Nov 2026):
 *  - GET  /unico/v1/screen/tbar  -> data: TbarScreen[] for the currently selected screens
 *  - PUT  /unico/v1/screen/tbar  <- the same array with `percent` changed
 *  - percent 0..4095 positions the transition; 4096 completes the take and the device resets to 0.
 *  - The device always counts up from 0, whichever way the physical bar moves; the controller
 *    (PixelHue U5 Mini, or this module) flips direction after each completed take.
 */

export const TBAR_FULL = 4096

/** Default gap between T-bar updates sent to the device, in ms */
export const DEFAULT_TBAR_INTERVAL_MS = 15

/** A pause longer than this between bar positions counts as the start of a new movement */
const GLIDE_MAX_MS = 100

/**
 * Fills in between bar positions. A hardware bar reports far fewer positions than the device takes
 * (an LC-11 has 256, the device 4096), so jumping straight to each one shows as steps. Instead the
 * output glides from where it is to each new position, taking as long as the gap since the previous
 * position. While the bar moves steadily this gives a steady movement, at most one gap behind.
 */
export class TbarGlide {
	private from = 0
	private to = 0
	private startedAt = 0
	private duration = 0
	private lastTargetAt = -Infinity

	/** Glide to `target`; `firstStepMs` is how long the first glide of a new movement takes */
	setTarget(target: number, now: number, firstStepMs: number): void {
		this.from = this.valueAt(now, false)
		this.to = target
		const sincePrevious = now - this.lastTargetAt
		this.duration = sincePrevious > GLIDE_MAX_MS ? firstStepMs : Math.max(1, sincePrevious)
		this.startedAt = now
		this.lastTargetAt = now
	}

	/** Go straight to `value`, with no glide */
	jump(value: number, now: number): void {
		this.from = this.to = value
		this.duration = 0
		this.startedAt = now
		this.lastTargetAt = now
	}

	/** The position at `now`: rounded to a whole device step unless `round` is false */
	valueAt(now: number, round = true): number {
		const t = this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.startedAt) / this.duration))
		const v = this.from + (this.to - this.from) * t
		return round ? Math.min(TBAR_FULL - 1, Math.max(0, Math.round(v))) : v
	}

	/** True once the glide has reached its target */
	done(now: number): boolean {
		return this.duration <= 0 || now - this.startedAt >= this.duration
	}
}

export interface TbarScreen {
	screenId: number
	screenGuid: string
	percent: number
	effectSelect: number
	switchEffect: { time: number; type: number }
	swapEnable: number
	[key: string]: unknown
}

/**
 * Turns an absolute bar position (0..1, either end can be the start) into transition progress
 * for the device, flipping the start end after every completed take.
 */
export class TbarTracker {
	/** Which end the current transition starts from (0 or 1); null = not known yet */
	private startEnd: 0 | 1 | null = null
	/** Last percent handed out (0 after a completed take) */
	private last = 0

	/** @param endTolerance fraction of travel treated as "at the end" (absorbs jitter at both ends) */
	constructor(private readonly endTolerance = 0.01) {}

	/** Forget the direction; the next position picks the nearest end as the start */
	reset(): void {
		this.startEnd = null
		this.last = 0
	}

	get start(): 0 | 1 | null {
		return this.startEnd
	}

	/**
	 * @param position bar position, 0..1 (clamped)
	 * @returns percent to send (0..4096), or null when nothing changed
	 */
	update(position: number): number | null {
		if (!Number.isFinite(position)) return null
		const pos = Math.min(1, Math.max(0, position))

		if (this.startEnd === null) {
			this.startEnd = pos < 0.5 ? 0 : 1
			this.last = 0
		}

		const progress = this.startEnd === 0 ? pos : 1 - pos

		if (progress >= 1 - this.endTolerance) {
			// Reached the far end: complete the take; that end is now the start of the next one
			this.startEnd = this.startEnd === 0 ? 1 : 0
			this.last = 0
			return TBAR_FULL
		}

		// The travel between the two end zones is stretched over the whole range, so leaving the start
		// end moves the transition smoothly from 0 instead of jumping by the size of the end zone
		const tol = this.endTolerance
		const stretched = Math.max(0, (progress - tol) / (1 - 2 * tol))
		const percent = Math.min(TBAR_FULL - 1, Math.round(stretched * TBAR_FULL))
		if (percent === this.last) return null
		this.last = percent
		return percent
	}
}

/**
 * Sends T-bar positions one at a time, at most every `minGapMs`. Intermediate positions are
 * coalesced (only the newest is sent); a completion (4096) is never dropped or merged.
 */
export class TbarSender {
	private queue: number[] = []
	private busy = false
	private lastSentAt = -Infinity

	constructor(
		private readonly send: (percent: number) => Promise<void>,
		private minGapMs = 40,
		private readonly onError: (err: unknown) => void = () => {},
	) {}

	/** Change the minimum gap between sends */
	setMinGap(ms: number): void {
		this.minGapMs = ms
	}

	push(percent: number): void {
		const tail = this.queue.length - 1
		if (tail >= 0 && this.queue[tail] !== TBAR_FULL) {
			this.queue[tail] = percent
		} else {
			this.queue.push(percent)
		}
		if (!this.busy) void this.drain()
	}

	clear(): void {
		this.queue = []
	}

	private async drain(): Promise<void> {
		this.busy = true
		try {
			while (this.queue.length > 0) {
				// Timers can wake a little early, so check again until the gap really has passed
				let wait: number
				while ((wait = this.lastSentAt + this.minGapMs - performance.now()) > 0) {
					await new Promise((r) => setTimeout(r, Math.ceil(wait)))
				}
				const percent = this.queue.shift()!
				this.lastSentAt = performance.now()
				try {
					await this.send(percent)
				} catch (err) {
					this.onError(err)
				}
			}
		} finally {
			this.busy = false
		}
	}
}
