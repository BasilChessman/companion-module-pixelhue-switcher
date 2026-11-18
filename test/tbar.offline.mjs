// Offline test of the T-bar logic in the built module (no device). Run: yarn build && yarn test:tbar
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dist = process.argv[2]
const { TbarTracker, TbarSender, TBAR_FULL } = await import(pathToFileURL(path.join(dist, 'utils/tbar.js')).href)
const { TbarDriver } = await import(pathToFileURL(path.join(dist, 'services/TbarDriver.js')).href)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const ok = (name) => console.log(`ok ${++n} - ${name}`)

// --- Tracker ---
{
	const t = new TbarTracker()
	assert.equal(t.update(0), null, 'at start: nothing to send')
	assert.equal(t.start, 0)
	assert.equal(t.update(0.5), 2048)
	assert.equal(t.update(0.5), null, 'unchanged -> null')
	assert.equal(t.update(0.25), 1024, 'going back reduces progress')
	assert.equal(t.update(1), TBAR_FULL, 'far end completes')
	assert.equal(t.start, 1, 'direction flipped')
	assert.equal(t.update(1), null, 'resting at new start')
	assert.equal(t.update(0.75), 1024, 'moving back counts up from 0')
	assert.equal(t.update(0), TBAR_FULL, 'other end completes')
	assert.equal(t.start, 0)
	ok('tracker: sweep both ways, flip after completion')
}
{
	const t = new TbarTracker()
	assert.equal(t.update(1), null, 'first value at max end -> start=1')
	assert.equal(t.start, 1)
	assert.equal(t.update(0.996), null, 'jitter inside end tolerance ignored')
	assert.equal(t.update(0.5), 2048)
	assert.equal(t.update(0.004), TBAR_FULL, 'within tolerance of far end completes')
	ok('tracker: starts at nearest end, end tolerance')
}
{
	const t = new TbarTracker()
	t.update(0)
	t.update(0.6)
	t.reset()
	assert.equal(t.update(0.6), 1638, 'after reset nearest end (1) is the start: progress 0.4')
	assert.equal(t.start, 1)
	assert.equal(t.update(0.9999), 0, 'back to start sends 0')
	ok('tracker: reset')
}
{
	const t = new TbarTracker()
	t.update(0)
	assert.equal(t.update(0.9985), TBAR_FULL)
	const t2 = new TbarTracker()
	t2.update(0)
	assert.equal(t2.update(0.98), 4014)
	assert.ok(t2.update(0.985) <= 4095, 'never 4096 short of the end')
	assert.equal(t.update(NaN), null)
	ok('tracker: never sends 4096 before the end; NaN ignored')
}

// --- Sender ---
{
	const sent = []
	const s = new TbarSender(async (p) => {
		sent.push(p)
		await sleep(20)
	}, 10)
	for (const p of [100, 200, 300, 400]) s.push(p)
	await sleep(200)
	assert.deepEqual(sent, [100, 400], 'intermediate values coalesced to the newest')
	ok('sender: coalesces')
}
{
	const sent = []
	const s = new TbarSender(async (p) => {
		sent.push(p)
		await sleep(20)
	}, 10)
	s.push(3000)
	s.push(3500)
	s.push(TBAR_FULL)
	s.push(50)
	s.push(80)
	await sleep(300)
	assert.deepEqual(sent, [3000, TBAR_FULL, 80], 'completion kept, later values coalesced after it')
	ok('sender: never drops a completion')
}
{
	const sent = [],
		errs = []
	const s = new TbarSender(
		async (p) => {
			if (p === 1) throw new Error('boom')
			sent.push(p)
		},
		0,
		(e) => errs.push(e),
	)
	s.push(1)
	await sleep(20)
	s.push(2)
	await sleep(20)
	assert.deepEqual(sent, [2])
	assert.equal(errs.length, 1)
	ok('sender: error reported, keeps going')
}

// --- Driver with a fake switcher (LC-11 style 0..255) ---
{
	const puts = [],
		gets = [],
		logs = []
	const screensOnDevice = [
		{ screenId: 6, screenGuid: 'a', percent: 0, effectSelect: 0, switchEffect: { time: 500, type: 1 }, swapEnable: 1 },
		{ screenId: 8, screenGuid: 'b', percent: 0, effectSelect: 0, switchEffect: { time: 500, type: 1 }, swapEnable: 1 },
	]
	const fake = {
		log: (lvl, msg) => logs.push([lvl, msg]),
		apiClient: {
			http: {},
			getTbar: async () => {
				gets.push(1)
				return screensOnDevice.map((s) => ({ ...s }))
			},
			setTbar: async (screens, percent) => {
				puts.push({ percent, ids: screens.map((s) => s.screenId), screens })
			},
		},
	}
	const d = new TbarDriver(fake)
	const feed = async (vals) => {
		for (const v of vals) {
			d.position(v, 0, 255)
			await sleep(50)
		}
	}

	await feed([0, 0, 64, 128, 192, 255])
	assert.deepEqual(
		puts.map((p) => p.percent),
		[1028, 2056, 3084, TBAR_FULL],
	)
	assert.equal(gets.length, 1, 'screens read once per move')
	assert.deepEqual(puts[0].ids, [6, 8])
	assert.deepEqual(puts[0].screens[0].switchEffect, { time: 500, type: 1 }, 'device transition settings passed through')

	puts.length = 0
	await feed([255, 128, 0])
	assert.deepEqual(
		puts.map((p) => p.percent),
		[2040, TBAR_FULL],
		'reverse sweep counts up and completes',
	)
	assert.equal(gets.length, 2, 'screens re-read for the next move')

	puts.length = 0
	await feed([60, 0])
	assert.deepEqual(
		puts.map((p) => p.percent),
		[964, 0],
		'partial move then back to start sends 0',
	)

	d.position(5, 10, 10) // min === max ignored
	d.position(NaN, 0, 255)
	await sleep(60)
	assert.deepEqual(
		puts.map((p) => p.percent),
		[964, 0],
	)

	screensOnDevice.length = 0
	puts.length = 0
	await feed([128])
	assert.equal(puts.length, 0, 'no screens selected -> nothing sent')
	assert.ok(logs.some(([l, m]) => l === 'warn' && /no screens/.test(m)))
	ok('driver: LC-11 sweeps, screens per move, pass-through settings, no-screen warning')
}
{
	// min/max reversed (bar wired the other way) works too
	const puts = []
	const fake = {
		log() {},
		apiClient: {
			http: {},
			getTbar: async () => [{ screenId: 1, screenGuid: 'x', percent: 0 }],
			setTbar: async (s, p) => puts.push(p),
		},
	}
	const d = new TbarDriver(fake)
	for (const v of [255, 128, 0]) {
		d.position(v, 255, 0)
		await sleep(50)
	}
	assert.deepEqual(puts, [2040, TBAR_FULL])
	ok('driver: reversed min/max')
}
console.log('all passed')
