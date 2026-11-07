import type { ModuleInstance } from '../main.js'

/**
 * core = screens, presets, layers (what changes on take/cut/source/preset load)
 * full = core + interfaces, crop sources, input backups
 */
export type SyncScope = 'core' | 'full'

const MIN_GAP_MS = 250

function mergeScope(a: SyncScope | null, b: SyncScope): SyncScope {
	return a === 'full' || b === 'full' ? 'full' : 'core'
}

/** Fingerprint of everything that affects action/feedback/variable/preset *definitions* */
export function structureKey(self: ModuleInstance): string {
	return JSON.stringify([
		self.screens.map((s) => [s.screenId, s.guid, s.general?.name, s.enable, s.screenIdObj?.type]),
		self.presets.map((p) => [p.guid, p.serial, p.name]),
		self.layers.map((l) => [
			l.layerId,
			l.serial,
			l.layerIdObj?.attachScreenId,
			l.layerIdObj?.sceneType,
			l.general?.name,
		]),
		self.interfaces.map((i) => [i.interfaceId, i.general?.name, i.linkInfo?.isLink]),
		self.cropSources.map((c) => [c.cropId, c.name]),
		(self.sourceBackups.sourceBackup?.backup ?? []).map((b) => b.id),
	])
}

/** Push current state to Companion; rebuild definitions only when the structure changed */
export function publishState(self: ModuleInstance, structureBefore: string): void {
	if (structureBefore !== structureKey(self)) {
		self.updateActions()
		self.updateFeedbacks()
		self.updateVariableDefinitions()
		self.updatePresets()
	}
	self.updateVariableValues()
	self.checkFeedbacks()
}

/**
 * Re-reads device state over HTTP. Used whenever the WebSocket reports something
 * we can't apply incrementally, after our own commands, after reconnects, and on a poll.
 */
export class StateSync {
	private readonly self: ModuleInstance
	private debounceTimer: NodeJS.Timeout | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private readonly delayedTimers = new Set<NodeJS.Timeout>()
	private requestedScope: SyncScope | null = null
	private pendingScope: SyncScope | null = null
	private running = false
	private lastRunAt = 0
	private generation = 0
	private writesInFlight = 0
	private writeSeq = 0

	constructor(self: ModuleInstance) {
		this.self = self
	}

	request(reason: string, scope: SyncScope = 'core', delayMs = 150): void {
		this.requestedScope = mergeScope(this.requestedScope, scope)
		if (this.debounceTimer) return

		const wait = Math.max(delayMs, this.lastRunAt + MIN_GAP_MS - Date.now(), 0)
		this.self.log('debug', `State resync requested (${reason}, ${scope}) in ${wait}ms`)
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null
			const s = this.requestedScope ?? 'core'
			this.requestedScope = null
			void this.run(s)
		}, wait)
	}

	/**
	 * A command is being sent. Actions update local state optimistically (e.g. Load Preset sets the
	 * screen selection that TAKE relies on), so a resync must not overwrite it with device state read
	 * before the command landed.
	 */
	writeStarted(): void {
		this.writesInFlight++
		this.writeSeq++
	}

	writeFinished(ok: boolean): void {
		this.writesInFlight = Math.max(0, this.writesInFlight - 1)
		if (ok) {
			this.requestAfterWrite()
		} else if (this.writesInFlight === 0) {
			// Failed command: local optimistic state may be wrong, re-read soon
			this.request('after failed command', 'core', 0)
		}
	}

	/** After we send a command: resync shortly after, and again once a transition has likely finished */
	requestAfterWrite(): void {
		for (const delay of [300, 1500]) {
			const t = setTimeout(() => {
				this.delayedTimers.delete(t)
				this.request('after command', 'core', 0)
			}, delay)
			this.delayedTimers.add(t)
		}
	}

	startPolling(seconds: number | undefined): void {
		this.stopPolling()
		const s = Number(seconds)
		if (!Number.isFinite(s) || s <= 0) return
		this.pollTimer = setInterval(() => this.request('poll', 'core', 0), Math.max(1, s) * 1000)
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	stop(): void {
		this.generation++
		this.stopPolling()
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		this.delayedTimers.forEach((t) => clearTimeout(t))
		this.delayedTimers.clear()
		this.requestedScope = null
		this.pendingScope = null
	}

	private async run(scope: SyncScope): Promise<void> {
		if (this.running) {
			this.pendingScope = mergeScope(this.pendingScope, scope)
			return
		}

		const api = this.self.apiClient
		if (!api?.http) return

		// A command is in flight; writeFinished() will schedule a resync once it lands
		if (this.writesInFlight > 0) {
			this.pendingScope = mergeScope(this.pendingScope, scope)
			return
		}

		const gen = this.generation
		const seq = this.writeSeq
		this.running = true
		this.lastRunAt = Date.now()

		try {
			const [screens, presets, layers] = await Promise.all([api.getScreens(), api.getPresets(), api.getLayers()])
			const extra =
				scope === 'full' ? await Promise.all([api.getInterfaces(), api.getCropSources(), api.getBackupSource()]) : null

			if (gen !== this.generation || this.self.apiClient !== api) return

			// A command started while we were reading; this snapshot may predate it. Discard and retry.
			if (seq !== this.writeSeq) {
				this.pendingScope = mergeScope(this.pendingScope, scope)
				return
			}

			const before = structureKey(this.self)
			if (Array.isArray(screens.data?.list)) this.self.screens = screens.data.list
			if (Array.isArray(presets.data?.list)) this.self.presets = presets.data.list
			if (Array.isArray(layers.data?.list)) this.self.layers = layers.data.list
			if (extra) {
				const [interfaces, crops, backups] = extra
				if (Array.isArray(interfaces.data?.list)) this.self.interfaces = interfaces.data.list
				if (Array.isArray(crops.data?.list)) this.self.cropSources = crops.data.list
				if (backups.data?.sourceBackup) this.self.sourceBackups = backups.data
			}
			publishState(this.self, before)
		} catch (err) {
			this.self.log('warn', `State resync failed: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			this.running = false
			if (gen === this.generation && this.pendingScope) {
				const next = this.pendingScope
				this.pendingScope = null
				this.request('queued', next, 0)
			}
		}
	}
}
