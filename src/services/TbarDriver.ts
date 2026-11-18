import type { ModuleInstance } from '../main.js'
import { TBAR_FULL, TbarScreen, TbarSender, TbarTracker } from '../utils/tbar.js'

/**
 * Drives the switcher's T-bar from an external position (e.g. a hardware T-bar's variable).
 * The screens (and their transition settings) are read from the device at the start of each move,
 * so the T-bar acts on whatever screens are selected on the switcher, like the PixelHue U5 does.
 */
export class TbarDriver {
	private readonly tracker = new TbarTracker()
	private readonly sender: TbarSender
	private screens: TbarScreen[] | null = null
	private warnedNoScreens = false

	constructor(private readonly self: ModuleInstance) {
		this.sender = new TbarSender(
			async (percent) => this.send(percent),
			40,
			(err) => this.self.log('warn', `T-bar send failed: ${err instanceof Error ? err.message : String(err)}`),
		)
	}

	/** Feed a new bar position. `value` is mapped from [min, max] to 0..1 (either order works). */
	position(value: number, min: number, max: number): void {
		if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return
		const percent = this.tracker.update((value - min) / (max - min))
		if (percent !== null) this.sender.push(percent)
	}

	/** Forget which end is the start; the next position picks the nearest end */
	reset(): void {
		this.sender.clear()
		this.tracker.reset()
		this.screens = null
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
