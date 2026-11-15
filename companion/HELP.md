# Pixelhue Switcher Module

This module provides comprehensive control for Pixelhue video switching devices including the P10, P20, and Q8 models. (Note: F4, F4 Lite, and F8 models are currently not supported)

## Configuration

### Initial Setup

1. **IP Address**: Enter the IP address of your Pixelhue device
2. **Device Model**: Select your specific device model (P10, P20, or Q8)
3. **Authentication**: Enter the device account password
4. **Connection**: Save the configuration to establish connection

### Troubleshooting

- If connection errors occur, reconfigure the device settings
- Re-enter all configuration details including IP address and password
- Ensure the device is powered on and accessible on the network

## Available Actions

### Basic Control Actions

- **Take**: Execute a program transition (move preview to program)
- **Cut**: Perform an immediate cut transition without fade
- **FTB (Fade to Black)**: Fade the output to black
- **Freeze**: Freeze the current output frame

### Preset Management

- **Load Preset**: Load a specific preset by ID with destination options (Preview/Program)
- **Apply Layer Preset**: Apply preset settings to specific layers

### Screen Control

- **Select Screen**: Choose which screen to control
- **Bring Screen To**: Move a screen to preview or program

### Layer Management

- **Select Layer**: Choose specific layer for control
- **Change Layer Bounds**: Modify layer position and size parameters
- **Set Effect Time**: Configure transition timing for effects

### Advanced Features

- **Toggle UMD (Under Monitor Display)**: Control UMD display visibility
- **Swap/Copy Operations**: Manage content swapping between outputs

## Available Feedbacks

### Global State Feedbacks

- **Global Load In State**: Shows current global load-in mode (Preview/Program)
- **Global FTB State**: Indicates if global fade-to-black is active
- **Global Freeze State**: Shows if global freeze is enabled
- **Swap State**: Displays current swap/copy status

### Preset Feedbacks

- **Preset State**: Shows which preset is currently loaded and in which mode (Preview/Program)

### Screen Feedbacks

- **Screen Selection State**: Indicates which screen is currently selected
- **Screen Freeze State**: Shows freeze status for individual screens
- **Screen FTB State**: Displays fade-to-black status for specific screens

## Available Presets

The module includes pre-configured button presets organized by category:

### Control Presets

- **TAKE Button**: Red button for executing transitions
- **CUT Button**: Black button for immediate cuts
- **FTB Button**: Fade to black control
- **FREEZE Button**: Output freeze control

### Screen Presets

- Screen selection buttons with appropriate labeling
- Screen-specific control buttons

### Preset Presets

- Quick access buttons for loading saved presets
- Preset buttons with preview/program destination options

### Layer Presets

- Layer selection and control buttons
- Layer-specific parameter controls

### Display Presets

- UMD and display control buttons
- Visual feedback indicators

## Device Communication

This module uses both WebSocket and REST API communication for:

- Real-time status updates via WebSocket connection
- Command execution via HTTP REST API
- Automatic reconnection handling
- State synchronization between device and Companion

## Supported Device Models

| Model   | Status           | Features         |
| ------- | ---------------- | ---------------- |
| P10     | ✅ Supported     | Full feature set |
| P20     | ✅ Supported     | Full feature set |
| Q8      | ✅ Supported     | Full feature set |
| F4      | ❌ Not Available | -                |
| F4 Lite | ❌ Not Available | -                |
| F8      | ❌ Not Available | -                |

## Technical Requirements

- **Network**: Device must be accessible via IP network
- **Ports**: HTTP and WebSocket ports must be accessible
- **Authentication**: Device password required for access
- **Companion Version**: Compatible with Companion v3.0+

## Tally

The module works out which inputs are in a layer on **Program** or **Preview** of each screen (normal screens and AUX outputs; multiviewer layers are ignored). Crops count as their parent input. Layers showing a screen or a gallery image do not count toward any input's tally.

### Tally variables

`<id>` is the input's interface ID. Look up the full list, with names, under the connection's **Variables** tab.

| Variable                                          | Value                                         |
| ------------------------------------------------- | --------------------------------------------- |
| `tally_input_<id>_state`                          | `PGM`, `PVW` or `OFF` (Program wins)          |
| `tally_input_<id>_pgm` / `_pvw`                   | `true` / `false`, on any screen               |
| `tally_input_<id>_screen_<screenId>_pgm` / `_pvw` | `true` / `false` for one specific screen      |
| `tally_input_<id>_pgm_screens` / `_pvw_screens`   | Comma-separated names of the screens it is on |
| `tally_input_<id>_name`                           | Input name                                    |
| `screen_<screenId>_pgm_sources` / `_pvw_sources`  | Comma-separated sources on that screen        |
| `tally_pgm_inputs` / `tally_pvw_inputs`           | Comma-separated inputs on any screen          |

For "on screen A **or** B", use an expression variable such as (replace `pixelhue` with your connection label)
`$(pixelhue:tally_input_3_screen_1_pgm) || $(pixelhue:tally_input_3_screen_2_pgm)`.

### Tally feedback

**Source Tally (on Program / Preview)** lets you pick a source, a bus, one or more screens (empty = any), and whether the source must be on ANY or ALL of them.

## State refresh

Variables and feedbacks follow device reports over the WebSocket. When the device reports a change the module can't apply directly, after every command the module sends, and after a reconnect, the module re-reads screens, layers and presets. **State refresh interval** in the connection config adds a periodic re-read as a safety net. The default is 5 seconds; 0 turns it off.
