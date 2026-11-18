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

		const percent = progress <= this.endTolerance ? 0 : Math.min(TBAR_FULL - 1, Math.round(progress * TBAR_FULL))
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
	private lastSentAt = 0

	constructor(
		private readonly send: (percent: number) => Promise<void>,
		private readonly minGapMs = 40,
		private readonly onError: (err: unknown) => void = () => {},
	) {}

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
				const wait = this.lastSentAt + this.minGapMs - Date.now()
				if (wait > 0) await new Promise((r) => setTimeout(r, wait))
				const percent = this.queue.shift()!
				this.lastSentAt = Date.now()
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
