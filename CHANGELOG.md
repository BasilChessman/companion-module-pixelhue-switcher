# Companion Module: companion-module-pixelhue-switcher – Changelog

## [unreleased]

- Fixed variables/feedbacks going stale until the connection was toggled: unhandled device reports, layout updates, preset loads, reconnects and our own commands now trigger a state re-read
- Added configurable state refresh interval (safety-net polling)
- Added source tally variables (per input, per screen, PGM/PVW) and a Source Tally feedback
- State resync no longer overwrites screen selection set by Load Preset while commands are in flight (could make an early TAKE hit the wrong screens)
- Commands refused by the device (non-zero response code) are now logged as warnings
- Variables are now only pushed to Companion when their value changes
- Added the ability to load the layers presets
- Added move and resize layer actions
- Set Input on Layer: screens (program output) and image gallery pictures can now be selected as the layer input
- Switch Input Backup no longer toggles: choose the backup pair and whether to switch to its primary or backup source. Existing buttons without the new option switch to primary. Backup presets now come as a Primary/Backup pair
- Fixed Switch Input Backup on several pairs at once (e.g. one button with an action per pair) only switching one random pair: the device takes the whole backup list per command, and each action sent its own stale copy, so the last one undid the others. Switches are now queued, combined and applied on top of fresh device state
- Input Backup feedback can now indicate primary active as well as backup active (defaults to backup, as before)
- Tally no longer counts a screen or picture layer source as an input that happens to share its ID

## [2.0.2] – 2025‑07‑12

- Complete rewrite in TypeScript

## [2.0.0] – 2025‑07‑11

- Initial TypeScript rewrite release

## [1.3.2] – 2025‑06‑24

- Fixed preset loading area issue
- Restored F‑series presets (F4/F8)

## [1.3.1] – 2024‑11‑18

- Fixed init‑timeout bug

## [1.3.0] – 2024‑09‑09

- Updated actions: Screens, Layers, Sources, SwapCopy, MatchPgm, Take Time–/+, Mapping

## [1.2.2] – 2024‑03‑17

- Updated P10/P20/Q8 to password‑free configuration

## [1.2.1] – 2024‑02‑09

- Added compatibility for older devices

## [1.2.0] – 2024‑01‑03

- Fixed initialization bugs
- Updated upgrade scripts

## [1.1.1] – 2023‑12‑28

- Fixed upgrade scripts

## [1.1.0] – 2023‑12‑26

- Fixed legacy ID handling
