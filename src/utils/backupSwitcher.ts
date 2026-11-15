import type { ModuleInstance } from '../main.js'
import type { Backup, SourceBackup } from '../interfaces/SourceBackup.js'

/** Requests arriving within this window (e.g. several actions on one button) go out as one PUT */
const COALESCE_MS = 30
/**
 * How long a requested pair state is re-applied on top of device state. The device reports the
 * new state shortly after a PUT; until then a fresh read may still show the old value.
 */
const HOLD_MS = 3000

interface Desired {
	sourceId: number
	sourceType: number
	at: number
}

/**
 * The device only accepts the whole input backup list in one PUT. Building that list from the
 * local cache per action meant several actions fired together (one button, several pairs) each
 * sent "all pairs as cached + my change", and the last PUT undid the others. This queues the
 * requested pair states, coalesces them, and writes them one PUT at a time on top of a fresh read.
 */
export class BackupSwitcher {
	private readonly self: ModuleInstance
	private readonly desired = new Map<number, Desired>()
	private flushTimer: NodeJS.Timeout | null = null
	private waiters: Array<() => void> = []
	private chain: Promise<void> = Promise.resolve()
	private generation = 0

	constructor(self: ModuleInstance) {
		this.self = self
	}

	/** Ask for a backup pair to use the given source; resolves once the PUT containing it has been sent */
	async request(pairId: number, sourceId: number, sourceType: number): Promise<void> {
		this.desired.set(pairId, { sourceId, sourceType, at: Date.now() })
		return new Promise<void>((resolve) => {
			this.waiters.push(resolve)
			if (!this.flushTimer) {
				this.flushTimer = setTimeout(() => {
					this.flushTimer = null
					const waiters = this.waiters
					this.waiters = []
					this.chain = this.chain
						.then(async () => this.flush())
						.catch((err) => this.self.log('error', `switchSourceBackup failed: ${String(err)}`))
						.finally(() => waiters.forEach((w) => w()))
				}, COALESCE_MS)
			}
		})
	}

	stop(): void {
		this.generation++
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = null
		}
		this.desired.clear()
		this.waiters.forEach((w) => w())
		this.waiters = []
	}

	private async flush(): Promise<void> {
		const gen = this.generation
		const api = this.self.apiClient
		if (!api) return

		const now = Date.now()
		for (const [id, d] of this.desired) {
			if (now - d.at > HOLD_MS) this.desired.delete(id)
		}
		if (this.desired.size === 0) return

		let base: SourceBackup = this.self.sourceBackups
		try {
			const fresh = await api.getBackupSource()
			if (fresh.data?.sourceBackup?.backup) base = fresh.data
		} catch (err) {
			this.self.log(
				'warn',
				`switchSourceBackup: could not read current backup state, using cached: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
		if (gen !== this.generation) return

		let changed = false
		const backup = base.sourceBackup.backup.map((entry): Backup => {
			const want = this.desired.get(entry.id)
			if (!want || (entry.usingSourceId === want.sourceId && entry.usingSourceType === want.sourceType)) {
				return entry
			}
			changed = true
			return { ...entry, primaryFirst: 0, usingSourceId: want.sourceId, usingSourceType: want.sourceType }
		})

		const next: SourceBackup = { sourceBackup: { ...base.sourceBackup, backup } }
		this.self.sourceBackups = next

		if (changed) {
			try {
				this.self.log('debug', `Setting new backup source: ${JSON.stringify(next)}`)
				await api.setBackupSource(next)
			} catch (error) {
				this.self.log(
					'error',
					`switchSourceBackup send error: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		if (gen !== this.generation) return
		this.self.updateVariableValues()
		this.self.checkFeedbacks('sourceBackupState')
	}
}
