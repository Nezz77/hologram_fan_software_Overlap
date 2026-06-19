import math
import numpy as np
from PIL import Image
import os

def rgb_to_rgb565(r, g, b):
    # Compression from 24-bit RGB to 16-bit RGB565
    r5 = (r * 249 + 1014) >> 11
    g6 = (g * 253 + 505) >> 10
    b5 = (b * 249 + 1014) >> 11
    return (r5 << 11) + (g6 << 5) + b5

def process_media(file_path, overlap_cm, distance_cm, angle_fan1, angle_fan2, out_dir):
    try:
        overlap_cm = float(overlap_cm)
        distance_cm = float(distance_cm)
        angle_fan1 = float(angle_fan1)
        angle_fan2 = float(angle_fan2)
    except ValueError:
        raise Exception("Invalid parameters")

    NUM_LEDS = 200
    HALF_LEDS = int(NUM_LEDS / 2)
    resolution = 6 # degrees
    polar_rows = int(360 / resolution) # 60

    # Calculate geometry
    # R + R - distance = overlap  => 2R = distance + overlap
    R_cm = (distance_cm + overlap_cm) / 2.0
    if R_cm <= 0:
        raise Exception("Invalid distance and overlap")

    # Map real world units to LED counts
    # Radius = HALF_LEDS (100)
    # Therefore, 1 cm = 100 / R_cm (LEDs/cm)
    leds_per_cm = HALF_LEDS / R_cm
    
    dist_leds = distance_cm * leds_per_cm
    
    total_width_leds = NUM_LEDS
    total_height_leds = int(HALF_LEDS + dist_leds + HALF_LEDS)
    
    try:
        img = Image.open(file_path).convert('RGB')
    except Exception as e:
        raise Exception(f"Failed to open image: {e}")

    # Resize image to match our working "LED" resolution to make mapping 1:1
    # Actually, to prevent aliasing, let's keep original and map back.
    # But for simplicity and speed, let's just resize it to a good multiple.
    scale = 2.0
    w_px = int(total_width_leds * scale)
    h_px = int(total_height_leds * scale)
    
    # Crop and scale image to fit the aspect ratio
    img_ratio = img.width / img.height
    target_ratio = w_px / h_px
    if img_ratio > target_ratio:
        # Image is wider, crop width
        new_w = int(img.height * target_ratio)
        offset = (img.width - new_w) // 2
        img = img.crop((offset, 0, offset + new_w, img.height))
    else:
        # Image is taller, crop height
        new_h = int(img.width / target_ratio)
        offset = (img.height - new_h) // 2
        img = img.crop((0, offset, img.width, offset + new_h))
        
    img = img.resize((w_px, h_px), Image.Resampling.LANCZOS)
    
    center1_x = int((total_width_leds / 2) * scale)
    center1_y = int(HALF_LEDS * scale)
    
    center2_x = int((total_width_leds / 2) * scale)
    center2_y = int((HALF_LEDS + dist_leds) * scale)
    
    # Helper to generate a fan's binary
    def generate_fan_bin(center_x, center_y, angle_offset, filename):
        img_converted = [[0 for _ in range(HALF_LEDS)] for _ in range(polar_rows)]
        degrees = 0
        for row in range(polar_rows):
            # Apply angle offset for this fan
            effective_deg = (degrees + angle_offset) % 360
            rad = math.radians(effective_deg)
            
            for j in range(HALF_LEDS):
                # j is distance from center (0 to 99)
                # the original script mapped j=0 to the outer edge, let's assume j=0 is center and j=99 is edge.
                # Actually original script: j in range(HALF_LEDS). 
                # x = HALF_LEDS - (HALF_LEDS-j)*sin... so j=0 -> distance is HALF_LEDS. j=99 -> distance is 1.
                # Let's make radius = r
                r = HALF_LEDS - j # from 1 to 100
                
                # polar to cartesian
                dx = r * math.sin(rad)
                dy = r * math.cos(rad)
                
                # Image coordinates
                px = int(center_x + dx * scale)
                py = int(center_y - dy * scale) # Y goes down in images
                
                if px < 0: px = 0
                if py < 0: py = 0
                if px >= w_px: px = w_px - 1
                if py >= h_px: py = h_px - 1
                
                red8, green8, blue8 = img.getpixel((px, py))
                
                rgb565 = rgb_to_rgb565(red8, green8, blue8)
                img_converted[row][j] = rgb565
                
            degrees += resolution
            
        # Write to bin file
        bin_path = os.path.join(out_dir, filename)
        with open(bin_path, 'wb') as f:
            for row in range(polar_rows):
                for j in range(HALF_LEDS):
                    val = img_converted[row][j]
                    # Write as little-endian 16-bit
                    f.write(val.to_bytes(2, byteorder='little'))
                    
        return bin_path

    bin1 = generate_fan_bin(center1_x, center1_y, angle_fan1, 'fan1.bin')
    bin2 = generate_fan_bin(center2_x, center2_y, angle_fan2, 'fan2.bin')
    
    return [bin1, bin2]
