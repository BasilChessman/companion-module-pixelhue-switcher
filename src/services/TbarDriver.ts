import type { ModuleInstance } from '../main.js'
import { DEFAULT_TBAR_INTERVAL_MS, TBAR_FULL, TbarGlide, TbarScreen, TbarSender, TbarTracker } from '../utils/tbar.js'

/**
 * Drives the switcher's T-bar from an external position (e.g. a hardware T-bar's variable).
 * The screens (and their transition settings) are read from the device at the start of each move,
 * so the T-bar acts on whatever screens are selected on the switcher, like the PixelHue U5 does.
 */
export class TbarDriver {
	private readonly tracker = new TbarTracker()
	private readonly glide = new TbarGlide()
	private readonly sender: TbarSender
	private screens: TbarScreen[] | null = null
	private warnedNoScreens = false
	private intervalMs = DEFAULT_TBAR_INTERVAL_MS
	private smooth = true
	private ticker: ReturnType<typeof setInterval> | undefined
	private lastPushed: number | undefined

	constructor(private readonly self: ModuleInstance) {
		this.sender = new TbarSender(
			async (percent) => this.send(percent),
			this.intervalMs,
			(err) => this.self.log('warn', `T-bar send failed: ${err instanceof Error ? err.message : String(err)}`),
		)
	}

	/**
	 * Feed a new bar position. `value` is mapped from [min, max] to 0..1 (either order works).
	 * @param intervalMs minimum gap between updates sent to the device
	 * @param smooth glide between positions instead of jumping to each one
	 */
	position(value: number, min: number, max: number, intervalMs = DEFAULT_TBAR_INTERVAL_MS, smooth = true): void {
		if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return
		this.setOptions(intervalMs, smooth)
		const percent = this.tracker.update((value - min) / (max - min))
		if (percent === null) return
		const now = performance.now()

		if (percent >= TBAR_FULL || !this.smooth) {
			// A completion goes straight out (and is never merged away); the next move starts from 0
			this.stopTicker()
			this.glide.jump(percent >= TBAR_FULL ? 0 : percent, now)
			this.push(percent)
			return
		}
		this.glide.setTarget(percent, now, this.intervalMs)
		this.tick()
		this.ticker ??= setInterval(() => this.tick(), Math.max(5, this.intervalMs / 2))
	}

	/** Forget which end is the start; the next position picks the nearest end */
	reset(): void {
		this.stopTicker()
		this.sender.clear()
		this.tracker.reset()
		this.glide.jump(0, performance.now())
		this.lastPushed = undefined
		this.screens = null
	}

	private setOptions(intervalMs: number, smooth: boolean): void {
		const ms = Number.isFinite(intervalMs) ? Math.min(200, Math.max(5, intervalMs)) : DEFAULT_TBAR_INTERVAL_MS
		if (ms !== this.intervalMs) {
			this.intervalMs = ms
			this.sender.setMinGap(ms)
			this.stopTicker() // restarted at the new rate by the next position
		}
		this.smooth = smooth
	}

	private tick(): void {
		const now = performance.now()
		this.push(this.glide.valueAt(now))
		if (this.glide.done(now)) this.stopTicker()
	}

	private push(percent: number): void {
		if (percent === this.lastPushed) return
		this.lastPushed = percent >= TBAR_FULL ? 0 : percent
		this.sender.push(percent)
	}

	private stopTicker(): void {
		if (this.ticker) clearInterval(this.ticker)
		this.ticker = undefined
	}

	private async send(percent: number): Promise<void> {
		const api = this.self.apiClient
		if (!api?.http) return

		if (this.screens === null) {
			// Nothing has moved yet and nothing is cached: no need to touch the device for a 0
			if (percent === 0) return
			this.screens = await api.getTbar()
		}
		if (this.screens.length === 0) {
			if (!this.warnedNoScreens) this.self.log('warn', 'T-bar: no screens selected on the switcher')
			this.warnedNoScreens = true
			this.screens = null
			return
		}
		this.warnedNoScreens = false

		const screens = this.screens
		// Back at the start, or take completed: re-read the selected screens before the next move
		if (percent === 0 || percent >= TBAR_FULL) this.screens = null
		await api.setTbar(screens, percent)
	}
}
