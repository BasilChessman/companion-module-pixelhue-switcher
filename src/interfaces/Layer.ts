export interface LayerListDetailData {
	totalCount: number
	list: Layer[]
}

export interface LayerSelection {
	layerId: number
	selected: 0 | 1
}

export interface Layer {
	layerId: number
	general: LayerGeneral
	source: LayerSource
	selected: 0 | 1
	serial: number
	layerIdObj: LayerIdObj
	window: LayerBounds
	UMD: LayerUMD[]
}

export interface LayerIdObj {
	attachScreenId: number
	sceneType: number
}

export interface LayerGeneral {
	name: string
}

export interface LayerBounds {
	width: number
	height: number
	x: number
	y: number
}

export interface LayerSource {
	general: LayerSourceGeneral
}

export interface LayerSourceGeneral {
	sourceName: string
	sourceId?: number
	/** See LAYER_SOURCE_TYPE; for inputs this is the input's interfaceType */
	sourceType?: number
	connectorType?: number
}

export interface LayerUMD {
	area: number
	enable: 0 | 1
	name: string
	type: number
}

/** layer.source.general.sourceType values (device accepts 1,2,3,5,6,8 on normal layers) */
export const LAYER_SOURCE_TYPE = {
	/** Program output of another screen; sourceId = screenId */
	SCREEN: 3,
	/** Picture from the image gallery; sourceId = pictureId */
	PICTURE: 5,
	CROP: 8,
}
