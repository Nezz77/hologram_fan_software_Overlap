#include <Arduino.h>
#include <FFat.h>
#include <FastLED.h>
#include <WebServer.h>
#include <WiFi.h>

// ---------------------------------------------------------
// HARDWARE CONFIGURATION
// ---------------------------------------------------------
#define FAN_ID 2 // CHANGE TO 2 WHEN UPLOADING TO THE SECOND FAN!

#define NUM_LEDS 100 // LEDs per fan blade (half the strip)
#define DATA_PIN 11
#define CLOCK_PIN 12
#define HALL_PIN 4

#define POLAR_ROWS 60 // 360 degrees / 6 degree resolution

// ---------------------------------------------------------
// GLOBALS
// ---------------------------------------------------------
CRGB leds[NUM_LEDS];
WebServer server(80);

// Image data buffer (RGB565 format)
uint16_t fanBuffer[POLAR_ROWS][NUM_LEDS];
bool imageLoaded = false;

// Rotation tracking (set by ISR, read by loop)
volatile unsigned long hallTriggerTime = 0;
volatile unsigned long prevHallTriggerTime = 0;
volatile bool newRotation = false;

// ---------------------------------------------------------
// LOAD BINARY FILE FROM FLASH
// ---------------------------------------------------------
void loadBuffers() {
  Serial.println("Loading bin file from FFat...");

  String filename = (FAN_ID == 1) ? "/fan1.bin" : "/fan2.bin";

  if (FFat.exists(filename)) {
    File f = FFat.open(filename, FILE_READ);
    if (f) {
      for (int i = 0; i < POLAR_ROWS; i++) {
        f.read((uint8_t *)fanBuffer[i], NUM_LEDS * 2);
      }
      f.close();
      Serial.println(filename + " loaded successfully!");
      imageLoaded = true;
    }
  } else {
    Serial.println("No bin file found yet. Upload one via the app!");
    imageLoaded = false;
  }
}

// ---------------------------------------------------------
// RGB565 to CRGB Helper
// ---------------------------------------------------------
inline CRGB rgb565_to_crgb(uint16_t color) {
  uint8_t r = (color >> 11) & 0x1F;
  uint8_t g = (color >> 5) & 0x3F;
  uint8_t b = color & 0x1F;
  r = (r << 3) | (r >> 2);
  g = (g << 2) | (g >> 4);
  b = (b << 3) | (b >> 2);
  return CRGB(r, g, b);
}

// ---------------------------------------------------------
// HALL SENSOR INTERRUPT (lightweight - just records time)
// ---------------------------------------------------------
void IRAM_ATTR onHallSensor() {
  unsigned long now = micros();
  unsigned long diff = now - hallTriggerTime;

  // Debounce: ignore if faster than 3000 RPM (20ms per rotation)
  if (diff > 20000) {
    prevHallTriggerTime = hallTriggerTime;
    hallTriggerTime = now;
    newRotation = true;
  }
}

// ---------------------------------------------------------
// WEB SERVER HANDLERS
// ---------------------------------------------------------
File uploadFile;

void handleUpload() {
  HTTPUpload &upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    String path = "/" + upload.filename;
    Serial.printf("Upload Start: %s\n", path.c_str());
    uploadFile = FFat.open(path, FILE_WRITE);
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (uploadFile) {
      uploadFile.write(upload.buf, upload.currentSize);
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (uploadFile) {
      uploadFile.close();
      Serial.printf("Upload End: %s (%u bytes)\n", upload.filename.c_str(),
                    upload.totalSize);
      loadBuffers();
    }
  }
}

void handleUploadComplete() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "Upload Complete");
}

void handleCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.send(200);
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    handleCORS();
  } else {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(404, "text/plain", "Not Found");
  }
}

// ---------------------------------------------------------
// SETUP
// ---------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n=== Hologram Fan Firmware ===");
  Serial.print("Fan ID: ");
  Serial.println(FAN_ID);

  // Initialize LEDs
  FastLED.addLeds<APA102, DATA_PIN, CLOCK_PIN, BGR, DATA_RATE_MHZ(12)>(
      leds, NUM_LEDS);
  FastLED.setBrightness(25); // ~10% brightness
  FastLED.clear();
  FastLED.show();

  // Initialize FFat
  Serial.println("Mounting FFat (first boot may take a while)...");
  if (!FFat.begin(true)) {
    Serial.println("ERROR: FFat Mount Failed!");
  } else {
    Serial.printf("FFat OK. Total: %u bytes, Used: %u bytes\n",
                  FFat.totalBytes(), FFat.usedBytes());
    loadBuffers();
  }

  // Setup Wi-Fi AP
  if (FAN_ID == 1) {
    WiFi.softAP("HologramFan1", "12345678");
  } else {
    WiFi.softAP("HologramFan2", "12345678");
  }
  Serial.print("WiFi AP started! IP: ");
  Serial.println(WiFi.softAPIP());

  // Setup web server routes
  server.on("/upload", HTTP_POST, handleUploadComplete, handleUpload);
  server.on("/upload", HTTP_OPTIONS, handleCORS);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("Web server started!");

  // Setup Hall sensor interrupt
  pinMode(HALL_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(HALL_PIN), onHallSensor, FALLING);

  Serial.println("Ready! Waiting for rotation...");
}

// ---------------------------------------------------------
// MAIN LOOP - Renders LEDs safely (not in an ISR!)
// ---------------------------------------------------------
void loop() {
  // Handle any pending web requests
  server.handleClient();

  // Check if the hall sensor detected a new rotation
  if (newRotation && imageLoaded) {
    newRotation = false;

    unsigned long rotationUs = hallTriggerTime - prevHallTriggerTime;

    // Sanity check: only render if we have a valid rotation time
    if (rotationUs > 20000 && rotationUs < 500000) {
      unsigned long timePerRow = rotationUs / POLAR_ROWS;
      unsigned long rotationStart = hallTriggerTime;

      // Render all rows for this rotation
      for (int row = 0; row < POLAR_ROWS; row++) {
        // Fill LED buffer for this row
        for (int i = 0; i < NUM_LEDS; i++) {
          leds[i] = rgb565_to_crgb(fanBuffer[row][i]);
        }
        FastLED.show();

        // Wait until it's time for the next row
        unsigned long targetTime = rotationStart + (row + 1) * timePerRow;
        while (micros() < targetTime) {
          // Tight spin-wait for precise timing
        }
      }
    }
  }

  // If no rotation for 500ms, blank the LEDs
  if (micros() - hallTriggerTime > 500000) {
    FastLED.clear();
    FastLED.show();
    delay(50); // Save CPU when not spinning
  }
}
