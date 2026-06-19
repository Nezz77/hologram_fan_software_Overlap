# 🌀 Hologram Fan Array Software

A complete software suite for driving a **2×1 hologram fan array** using ESP32-S3 microcontrollers and APA102 LEDs. Includes a modern macOS desktop application for image processing and wireless upload, plus the POV (Persistence of Vision) firmware for the ESP32.

![Platform](https://img.shields.io/badge/Platform-macOS-blue)
![ESP32](https://img.shields.io/badge/MCU-ESP32--S3--N16R8-green)
![LEDs](https://img.shields.io/badge/LEDs-APA102%202020-red)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Hardware Requirements](#hardware-requirements)
- [Hardware Wiring](#hardware-wiring)
- [Array Geometry](#array-geometry)
- [Software Architecture](#software-architecture)
- [Getting Started](#getting-started)
  - [Step 1: Flash the ESP32 Firmware](#step-1-flash-the-esp32-firmware)
  - [Step 2: Install the macOS App](#step-2-install-the-macos-app)
  - [Step 3: Upload Your First Image](#step-3-upload-your-first-image)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

This project replaces legacy Windows-only hologram fan software (e.g., SpinDisplay.exe) with a fully open-source, cross-platform solution designed for macOS.

### How It Works

1. **You select an image** in the macOS app.
2. The app **maps the rectangular image onto polar coordinates** — splitting it into two halves, one for each fan in the array.
3. The processed data is converted into compact **RGB565 `.bin` files** (~12KB each).
4. You **wirelessly upload** each `.bin` file to the corresponding ESP32 over Wi-Fi.
5. Each ESP32 stores the file in its internal flash (FFat) and renders it using **Persistence of Vision (POV)** — driving the APA102 LEDs in sync with the fan's rotation via a Hall sensor.

The two fans together display **one seamless, unified holographic image**.

---

## Hardware Requirements

### Per Fan Unit (×2 needed for the array)

| Component | Specification |
|---|---|
| **Microcontroller** | ESP32-S3-N16R8 (16MB Flash, 8MB PSRAM) |
| **LED Strip** | APA102 2020 (200 LEDs per strip, 100 per blade) |
| **Hall Sensor** | Digital Hall effect sensor (e.g., A3144) |
| **Motor** | Brushless DC motor with fan blade mount |
| **Power Supply** | 5V, sufficient amperage for 100 LEDs |

### Tools Needed

| Tool | Purpose |
|---|---|
| **MacBook** (Apple Silicon or Intel) | Running the desktop application |
| **USB-C Cable** | Flashing the ESP32 firmware |
| **Arduino IDE 2.x** | Compiling and uploading the firmware |

---

## Hardware Wiring

Each ESP32 fan unit is wired identically:

```
ESP32-S3 Pin    →    Component
─────────────────────────────
GPIO 11         →    APA102 Data (DI)
GPIO 12         →    APA102 Clock (CI)
GPIO 4          →    Hall Sensor (Signal)
3.3V            →    Hall Sensor VCC
GND             →    Hall Sensor GND
5V (via VBUS)   →    APA102 VCC
GND             →    APA102 GND
```

> ⚠️ **Important:** The APA102 LEDs need a stable 5V power supply. Do NOT power all 100 LEDs directly from the ESP32's 5V pin — use a separate 5V regulator or power supply rated for at least 3A per fan.

---

## Array Geometry

The two fans are arranged in a **vertical 2-row × 1-column configuration**:

```
        ┌─────────────┐
        │   Fan 1     │  ← Top fan (FAN_ID = 1)
        │  (100 LEDs) │
        │      ●      │  ← Center of Fan 1
        │             │
        ├─────────────┤  ← 13cm overlap zone
        │             │
        │      ●      │  ← Center of Fan 2
        │  (100 LEDs) │
        │   Fan 2     │  ← Bottom fan (FAN_ID = 2)
        └─────────────┘

        |← 31cm between centers →|
```

| Parameter | Default Value | Adjustable? |
|---|---|---|
| Distance between centers | 31 cm | ✅ Yes (via app slider) |
| Overlap | 13 cm | ✅ Yes (via app slider) |
| Fan 1 angle offset | 0° | ✅ Yes (via app slider) |
| Fan 2 angle offset | 0° | ✅ Yes (via app slider) |

---

## Software Architecture

```
hologram_fan_software/
├── HologramFanFirmware/          # ESP32 Arduino firmware
│   └── HologramFanFirmware.ino   # Main firmware file
├── mac_app/                      # macOS desktop application
│   ├── electron/
│   │   └── main.cjs              # Electron main process
│   ├── src/
│   │   ├── App.jsx               # React app (UI + image processing)
│   │   └── index.css             # Styling (glassmorphism dark theme)
│   └── package.json
└── processing.py                 # Original Python reference script
```

### Data Flow

```
┌──────────────┐     Wi-Fi POST      ┌──────────────┐
│   macOS App  │ ──── fan1.bin ────→  │  ESP32 Fan 1 │
│              │                      │  (FFat flash) │
│  Image       │                      └──────────────┘
│  Processing  │
│  (JS/Canvas) │     Wi-Fi POST      ┌──────────────┐
│              │ ──── fan2.bin ────→  │  ESP32 Fan 2 │
└──────────────┘                      │  (FFat flash) │
                                      └──────────────┘
```

---

## Getting Started

### Prerequisites

- **Node.js** (v18 or later) — [Download](https://nodejs.org/)
- **Arduino IDE 2.x** — [Download](https://www.arduino.cc/en/software)
- **ESP32 Board Support** installed in Arduino IDE
- **FastLED** library installed in Arduino IDE

---

### Step 1: Flash the ESP32 Firmware

#### 1.1 Open the Arduino IDE

Open `HologramFanFirmware/HologramFanFirmware.ino` in the Arduino IDE.

#### 1.2 Configure Board Settings

Go to **Tools** menu and set the following:

| Setting | Value |
|---|---|
| Board | `ESP32S3 Dev Module` |
| Flash Size | `16MB (128Mb)` |
| Partition Scheme | `16M Flash (3MB APP/9.9MB FATFS)` |
| PSRAM | `OPI PSRAM` |
| Flash Mode | `QIO 80MHz` |
| CPU Frequency | `240MHz (WiFi)` |
| USB Mode | `Hardware CDC and JTAG` |
| Upload Mode | `UART0 / Hardware CDC` |
| Upload Speed | `921600` |

#### 1.3 Install Required Libraries

Go to **Sketch → Include Library → Manage Libraries** and install:

- **FastLED** (by Daniel Garcia)

> No other external libraries are needed — the firmware uses the built-in `WebServer` and `FFat` libraries.

#### 1.4 Upload to Fan 1

1. Ensure line 10 reads: `#define FAN_ID 1`
2. Connect Fan 1's ESP32 via USB.
3. Select the correct port under **Tools → Port**.
4. Click **Upload** (→ button).

#### 1.5 Upload to Fan 2

1. Change line 10 to: `#define FAN_ID 2`
2. Connect Fan 2's ESP32 via USB.
3. Select the correct port.
4. Click **Upload**.

#### 1.6 Verify

Open the **Serial Monitor** (115200 baud). You should see:

```
=== Hologram Fan Firmware ===
Fan ID: 1
Mounting FFat (first boot may take a while)...
FFat OK. Total: XXXXX bytes, Used: 0 bytes
WiFi AP started! IP: 192.168.4.1
Web server started!
Ready! Waiting for rotation...
```

---

### Step 2: Install the macOS App

```bash
# Navigate to the mac app directory
cd mac_app

# Install dependencies
npm install

# Install Electron and build tools
npm install electron electron-builder concurrently cross-env wait-on --save-dev

# Launch the app
npm run start
```

This will open a native macOS window with the hologram fan control interface.

---

### Step 3: Upload Your First Image

1. **In the macOS app**, click **"Select Image"** and choose any image file (JPG, PNG, etc.).

2. **Adjust the sliders** to match your physical setup:
   - Distance between centers: `31 cm`
   - Overlap: `13 cm`
   - Fan 1/2 Angle Offsets: Adjust to align the image between the two fans.

3. **Connect to Fan 1's Wi-Fi:**
   - Open your Mac's Wi-Fi settings.
   - Connect to **"HologramFan1"** (password: `12345678`).
   - In the app, click **"Upload Fan 1"**.

4. **Connect to Fan 2's Wi-Fi:**
   - Switch your Wi-Fi to **"HologramFan2"** (password: `12345678`).
   - In the app, click **"Upload Fan 2"**.

5. **Spin the fans!** The holographic image should now appear as a seamless display across both fans.

---

## Configuration

### Adjusting LED Brightness

In `HologramFanFirmware.ino`, modify this line:

```cpp
FastLED.setBrightness(25); // ~10% brightness (range: 0-255)
```

### Adjusting Resolution

The default angular resolution is **6 degrees** (60 rows per rotation). To change it, modify:

```cpp
#define POLAR_ROWS 60 // 360 / resolution_degrees
```

> ⚠️ You must also update `POLAR_ROWS` in `mac_app/src/App.jsx` to match.

### Adjusting Data Rate

For longer LED strip runs, you may need to reduce the SPI clock:

```cpp
FastLED.addLeds<APA102, DATA_PIN, CLOCK_PIN, BGR, DATA_RATE_MHZ(12)>(...);
//                                                  ^^^^^^^^^^^^^^^^
// Try DATA_RATE_MHZ(8) or DATA_RATE_MHZ(4) if you see flickering
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **Boot loop** (repeating `ESP-ROM` messages) | Ensure partition scheme is set to `16M Flash (3MB APP/9.9MB FATFS)` |
| **`tcp_alloc` crash** | Do NOT use `ESPAsyncWebServer` — the built-in `WebServer` is used instead |
| **Can't see Wi-Fi network** | Check Serial Monitor for errors. Ensure FFat mounts successfully |
| **Random color patterns** | No image uploaded yet — the buffer contains uninitialized data |
| **Image looks misaligned** | Adjust the angle offset sliders in the macOS app |
| **Upload fails from app** | Ensure your Mac is connected to the fan's Wi-Fi (`HologramFan1` or `HologramFan2`) |
| **LEDs too bright / dim** | Change `FastLED.setBrightness()` value (0–255) |
| **Flickering display** | Try reducing `DATA_RATE_MHZ` from 12 to 8 or 4 |

---

## Technical Details

### Binary File Format

Each `.bin` file contains the polar-mapped image data:

- **Format:** Raw RGB565 (16-bit per pixel, little-endian)
- **Structure:** `POLAR_ROWS` × `NUM_LEDS` × 2 bytes
- **Default size:** 60 × 100 × 2 = **12,000 bytes** (~12KB per fan)

### Image Processing Pipeline

1. Input image is loaded and cropped to match the array's aspect ratio.
2. Image is scaled to the working resolution.
3. For each fan, the app computes the center position based on distance and overlap.
4. Polar coordinate mapping samples the image at 60 angular positions × 100 radial positions.
5. Each pixel is converted from 24-bit RGB to 16-bit RGB565.
6. The result is packed into a binary file and sent over HTTP POST.

### POV Rendering

1. Hall sensor triggers an interrupt on each full rotation.
2. Rotation period is measured (typically 20–50ms for 1200–3000 RPM).
3. Period is divided into 60 equal time slots.
4. For each slot, the corresponding row of LED data is pushed via SPI to the APA102 strip.
5. Tight spin-wait ensures microsecond-accurate timing.

---

## License

MIT License — feel free to use, modify, and distribute.
