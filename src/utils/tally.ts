import type { ModuleInstance } from '../main.js'
import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import { Layer } from '../interfaces/Layer.js'
import { Screen, SCREEN_TYPE } from '../interfaces/Screen.js'
import { LoadIn } from '../interfaces/Preset.js'
import { Interface } from '../interfaces/Interface.js'

/** layer.source.general.sourceType used by the device for crop sources (see ApiClient.setCropSourceOnLayer) */
export const CROP_SOURCE_TYPE = 8

/** Screens that count as real outputs for tally. Multiviewer (MVR) layers are ignored. */
export const TALLY_SCREEN_TYPES = [SCREEN_TYPE.SCREEN, SCREEN_TYPE.AUX]

export type TallyBus = 'pgm' | 'pvw'

export interface ResolvedLayerSource {
	/** Physical input feeding the layer (crops resolve to their parent input) */
	interfaceId: number | null
	/** Set when the layer source is a crop */
	cropId: number | null
	name: string
}

export interface TallyState {
	/** interfaceId -> screenIds where that input is on the bus */
	inputs: Record<TallyBus, Map<number, Set<number>>>
	/** cropId -> screenIds where that crop is on the bus */
	crops: Record<TallyBus, Map<number, Set<number>>>
	/** screenId -> source names on the bus */
	screenSources: Record<TallyBus, Map<number, string[]>>
}

export function getTallyScreens(self: ModuleInstance): Screen[] {
	return self.getScreens(TALLY_SCREEN_TYPES)
}

/** Inputs exposed for tally: same set as the "Input Source" dropdowns (interfaceType 2, workMode 0) */
export function getTallyInputs(self: ModuleInstance): Interface[] {
	return self.getInterfaces(2, 0)
}

export function resolveLayerSource(self: ModuleInstance, layer: Layer): ResolvedLayerSource | null {
	const general = layer.source?.general
	if (!general) return null

	const sourceId = typeof general.sourceId === 'number' ? general.sourceId : undefined
	const sourceType = general.sourceType
	const name = general.sourceName ?? ''

	if (sourceId !== undefined) {
		if (sourceType === CROP_SOURCE_TYPE) {
			const crop = self.cropSources.find((c) => c.cropId === sourceId)
			if (crop) {
				return { interfaceId: crop.cropIdObj?.sourceId ?? null, cropId: sourceId, name: name || crop.name }
			}
		} else {
			const iface = self.interfaces.find((i) => i.interfaceId === sourceId)
			if (iface) {
				return { interfaceId: sourceId, cropId: null, name: name || iface.general.name }
			}
		}
	}

	// Fallback: match by name (older firmware may not report sourceId on layers)
	if (name) {
		const iface = self.interfaces.find((i) => i.general.name === name)
		return { interfaceId: iface?.interfaceId ?? null, cropId: null, name }
	}

	return null
}

function layerBus(layer: Layer): TallyBus | null {
	if (layer.layerIdObj?.sceneType === LoadIn.program) return 'pgm'
	if (layer.layerIdObj?.sceneType === LoadIn.preview) return 'pvw'
	return null
}

function addTo(map: Map<number, Set<number>>, key: number, screenId: number): void {
	let set = map.get(key)
	if (!set) {
		set = new Set()
		map.set(key, set)
	}
	set.add(screenId)
}

export function computeTally(self: ModuleInstance): TallyState {
	const state: TallyState = {
		inputs: { pgm: new Map(), pvw: new Map() },
		crops: { pgm: new Map(), pvw: new Map() },
		screenSources: { pgm: new Map(), pvw: new Map() },
	}

	const screensById = new Map(getTallyScreens(self).map((s) => [s.screenId, s]))

	for (const layer of self.layers) {
		const screen = screensById.get(layer.layerIdObj?.attachScreenId)
		if (!screen) continue

		const bus = layerBus(layer)
		if (!bus) continue

		if (layer.window && (layer.window.width <= 0 || layer.window.height <= 0)) continue

		const source = resolveLayerSource(self, layer)
		if (!source) continue

		if (source.interfaceId !== null) addTo(state.inputs[bus], source.interfaceId, screen.screenId)
		if (source.cropId !== null) addTo(state.crops[bus], source.cropId, screen.screenId)

		const names = state.screenSources[bus].get(screen.screenId) ?? []
		if (!names.includes(source.name)) names.push(source.name)
		state.screenSources[bus].set(screen.screenId, names)
	}

	return state
}

export function getTallyVariableDefinitions(self: ModuleInstance): CompanionVariableDefinition[] {
	const screens = getTallyScreens(self)
	const defs: CompanionVariableDefinition[] = [
		{ variableId: 'tally_pgm_inputs', name: 'Tally: Inputs on Program (any screen)' },
		{ variableId: 'tally_pvw_inputs', name: 'Tally: Inputs on Preview (any screen)' },
	]

	for (const input of getTallyInputs(self)) {
		const base = `tally_input_${input.interfaceId}`
		const label = `Tally "${input.general.name}"`
		defs.push(
			{ variableId: `${base}_name`, name: `${label}: Name` },
			{ variableId: `${base}_state`, name: `${label}: State (PGM / PVW / OFF)` },
			{ variableId: `${base}_pgm`, name: `${label}: On Program (any screen)` },
			{ variableId: `${base}_pvw`, name: `${label}: On Preview (any screen)` },
			{ variableId: `${base}_pgm_screens`, name: `${label}: Program screens` },
			{ variableId: `${base}_pvw_screens`, name: `${label}: Preview screens` },
		)
		for (const screen of screens) {
			defs.push(
				{
					variableId: `${base}_screen_${screen.screenId}_pgm`,
					name: `${label}: On Program of "${screen.general.name}"`,
				},
				{
					variableId: `${base}_screen_${screen.screenId}_pvw`,
					name: `${label}: On Preview of "${screen.general.name}"`,
				},
			)
		}
	}

	for (const screen of screens) {
		defs.push(
			{ variableId: `screen_${screen.screenId}_pgm_sources`, name: `Screen "${screen.general.name}": Program sources` },
			{ variableId: `screen_${screen.screenId}_pvw_sources`, name: `Screen "${screen.general.name}": Preview sources` },
		)
	}

	return defs
}

export function getTallyVariableValues(self: ModuleInstance): CompanionVariableValues {
	const tally = computeTally(self)
	const screens = getTallyScreens(self)
	const values: CompanionVariableValues = {}

	const screenNames = (ids: Set<number> | undefined): string =>
		screens
			.filter((s) => ids?.has(s.screenId))
			.map((s) => s.general.name)
			.join(', ')

	const pgmInputs: string[] = []
	const pvwInputs: string[] = []

	for (const input of getTallyInputs(self)) {
		const base = `tally_input_${input.interfaceId}`
		const pgm = tally.inputs.pgm.get(input.interfaceId)
		const pvw = tally.inputs.pvw.get(input.interfaceId)
		const onPgm = (pgm?.size ?? 0) > 0
		const onPvw = (pvw?.size ?? 0) > 0

		if (onPgm) pgmInputs.push(input.general.name)
		if (onPvw) pvwInputs.push(input.general.name)

		values[`${base}_name`] = input.general.name
		values[`${base}_state`] = onPgm ? 'PGM' : onPvw ? 'PVW' : 'OFF'
		values[`${base}_pgm`] = onPgm
		values[`${base}_pvw`] = onPvw
		values[`${base}_pgm_screens`] = screenNames(pgm)
		values[`${base}_pvw_screens`] = screenNames(pvw)
		for (const screen of screens) {
			values[`${base}_screen_${screen.screenId}_pgm`] = pgm?.has(screen.screenId) ?? false
			values[`${base}_screen_${screen.screenId}_pvw`] = pvw?.has(screen.screenId) ?? false
		}
	}

	for (const screen of screens) {
		values[`screen_${screen.screenId}_pgm_sources`] = (tally.screenSources.pgm.get(screen.screenId) ?? []).join(', ')
		values[`screen_${screen.screenId}_pvw_sources`] = (tally.screenSources.pvw.get(screen.screenId) ?? []).join(', ')
	}

	values.tally_pgm_inputs = pgmInputs.join(', ')
	values.tally_pvw_inputs = pvwInputs.join(', ')

	return values
}
