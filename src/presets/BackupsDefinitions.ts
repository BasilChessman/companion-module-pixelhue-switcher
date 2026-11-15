import { combineRgb, CompanionPresetDefinitions } from '@companion-module/base'
import type { ModuleInstance } from '../main.js'
import { PRESET_CATEGORY } from '../utils/constants.js'
import { BACKUP_TARGET } from '../interfaces/SourceBackup.js'

const TARGETS = [
	{ target: BACKUP_TARGET.PRIMARY, label: 'Primary' },
	{ target: BACKUP_TARGET.BACKUP, label: 'Backup' },
] as const

export function getBackupDefinitions(self: ModuleInstance): CompanionPresetDefinitions {
	const backupDefinitions: CompanionPresetDefinitions = {}

	self.sourceBackups.sourceBackup.backup.forEach((backup) => {
		backupDefinitions['presetLabelScreenToggle'] = {
			type: 'text',
			category: PRESET_CATEGORY.BACKUP,
			text: 'Input Backup',
			name: 'Input Backup',
		}

		for (const { target, label } of TARGETS) {
			backupDefinitions[`switchSourceBackup${backup.id}_${target}`] = {
				type: 'button',
				name: `Backup ${backup.id}: Switch to ${label}`,
				category: PRESET_CATEGORY.BACKUP,
				style: {
					text: `Backup ${backup.id}\n${label}`,
					size: 14,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 0, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'switchSourceBackup',
								options: {
									backupSourceId: backup.id,
									target,
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'sourceBackupState',
						style: {
							bgcolor: combineRgb(0, 204, 0),
							color: combineRgb(255, 255, 255),
						},
						options: {
							backupSourceId: backup.id,
							target,
						},
					},
				],
			}
		}
	})

	return backupDefinitions
}
