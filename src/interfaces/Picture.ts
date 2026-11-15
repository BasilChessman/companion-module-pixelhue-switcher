export interface PictureListData {
	list: Picture[]
	count: number
	page: number
	totalCount: number
	totalPage: number
}

/** Image from the device's picture gallery (GET /unico/v1/picture/list?type=1) */
export interface Picture {
	pictureId: number
	pictureObj: { id: number; order: number; type: number }
	general: { name: string; width: number; height: number }
	isUsed: 0 | 1
}
