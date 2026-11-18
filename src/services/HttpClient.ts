import got, { Method, OptionsOfJSONResponseBody } from 'got'

export class HttpClient {
	private host: string
	private apiPort: number
	private unicoPort: number
	private token: string | null = null

	constructor(host: string, apiPort: number, unicoPort: number = 19998) {
		this.host = host
		this.apiPort = apiPort
		this.unicoPort = unicoPort
	}

	setToken(token: string): void {
		this.token = token
	}

	private async request<T = any>(
		method: Method,
		path: string,
		options: Partial<OptionsOfJSONResponseBody> = {},
	): Promise<T> {
		const isSecure = path.startsWith('/ucenter')
		const baseUrl = isSecure ? `https://${this.host}:${this.unicoPort}` : `http://${this.host}:${this.apiPort}`

		const url = `${baseUrl}${path}`

		const headers = {
			...(this.token ? { Authorization: this.token } : {}),
			...options.headers,
		}

		const rejectUnauthorized = isSecure ? false : undefined

		return got(url, {
			method,
			...options,
			headers,
			https: {
				rejectUnauthorized,
			},
		}).json<T>()
	}

	async get<T = any>(path: string): Promise<T> {
		return this.request<T>('GET', path)
	}

	/** Called synchronously when a write (command) starts, and when it settles */
	onWriteStart: (() => void) | null = null
	onWriteEnd: ((ok: boolean) => void) | null = null
	/** Called when the device returns an error code in the response body */
	onDeviceError: ((message: string) => void) | null = null

	private async write<T>(method: Method, path: string, json: unknown): Promise<T> {
		this.onWriteStart?.()
		let ok = false
		const startedAt = Date.now()
		try {
			const res = await this.request<T>(method, path, { json })
			ok = true
			// The device answers HTTP 200 with a non-zero `code` when it refuses a command (e.g. busy)
			const body = res as { code?: unknown; message?: unknown } | null
			if (body && typeof body.code === 'number' && body.code !== 0) {
				const message = typeof body.message === 'string' ? body.message : JSON.stringify(body.message ?? '')
				this.onDeviceError?.(
					`${method} ${path} refused by device after ${Date.now() - startedAt}ms: code=${body.code} message=${message}`,
				)
			}
			return res
		} finally {
			this.onWriteEnd?.(ok)
		}
	}

	async post<T = any, B = Record<string, unknown>>(path: string, json: B): Promise<T> {
		return this.write<T>('POST', path, json)
	}

	async put<T = any, B = Record<string, unknown>>(path: string, json: B): Promise<T> {
		return this.write<T>('PUT', path, json)
	}

	/**
	 * PUT without the write hooks (no state resync per request). For high-rate commands such as
	 * T-bar positions; refusals are still reported via onDeviceError.
	 */
	async putUntracked<T = any, B = Record<string, unknown>>(path: string, json: B): Promise<T> {
		const res = await this.request<T>('PUT', path, { json })
		const body = res as { code?: unknown; message?: unknown } | null
		if (body && typeof body.code === 'number' && body.code !== 0) {
			const message = typeof body.message === 'string' ? body.message : JSON.stringify(body.message ?? '')
			this.onDeviceError?.(`PUT ${path} refused by device: code=${body.code} message=${message}`)
		}
		return res
	}
}
