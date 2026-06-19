import { useState, useRef, useEffect } from 'react';
import './index.css';

const NUM_LEDS = 200;
const HALF_LEDS = NUM_LEDS / 2;
const POLAR_ROWS = 60; // 360 / 6 degree resolution

function rgbToRgb565(r, g, b) {
  const r5 = (r * 249 + 1014) >> 11;
  const g6 = (g * 253 + 505) >> 10;
  const b5 = (b * 249 + 1014) >> 11;
  return (r5 << 11) + (g6 << 5) + b5;
}

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);
  const [distance, setDistance] = useState(31);
  const [overlap, setOverlap] = useState(13);
  const [angle1, setAngle1] = useState(0);
  const [angle2, setAngle2] = useState(0);
  const [status, setStatus] = useState({ state: 'idle', msg: 'Ready' });
  const [bins, setBins] = useState(null);

  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    if (imageSrc) {
      processImage();
    }
  }, [imageSrc, distance, overlap, angle1, angle2]);

  const processImage = () => {
    if (!imgRef.current) return;
    setStatus({ state: 'processing', msg: 'Processing Image...' });

    const R_cm = (parseFloat(distance) + parseFloat(overlap)) / 2.0;
    if (R_cm <= 0) {
      setStatus({ state: 'error', msg: 'Invalid distance/overlap' });
      return;
    }

    const leds_per_cm = HALF_LEDS / R_cm;
    const dist_leds = parseFloat(distance) * leds_per_cm;
    const scale = 2.0;

    const total_width_leds = NUM_LEDS;
    const total_height_leds = Math.floor(HALF_LEDS + dist_leds + HALF_LEDS);

    const w_px = Math.floor(total_width_leds * scale);
    const h_px = Math.floor(total_height_leds * scale);

    const canvas = canvasRef.current;
    canvas.width = w_px;
    canvas.height = h_px;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Draw scaled/cropped image
    const imgRatio = imgRef.current.width / imgRef.current.height;
    const targetRatio = w_px / h_px;
    let sX = 0, sY = 0, sW = imgRef.current.width, sH = imgRef.current.height;

    if (imgRatio > targetRatio) {
      sW = imgRef.current.height * targetRatio;
      sX = (imgRef.current.width - sW) / 2;
    } else {
      sH = imgRef.current.width / targetRatio;
      sY = (imgRef.current.height - sH) / 2;
    }

    ctx.drawImage(imgRef.current, sX, sY, sW, sH, 0, 0, w_px, h_px);
    const imageData = ctx.getImageData(0, 0, w_px, h_px).data;

    // Helper to get pixel
    const getPixel = (x, y) => {
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x >= w_px) x = w_px - 1;
      if (y >= h_px) y = h_px - 1;
      const idx = (Math.floor(y) * w_px + Math.floor(x)) * 4;
      return [imageData[idx], imageData[idx+1], imageData[idx+2]];
    };

    const center1_x = (total_width_leds / 2) * scale;
    const center1_y = HALF_LEDS * scale;
    const center2_x = (total_width_leds / 2) * scale;
    const center2_y = (HALF_LEDS + dist_leds) * scale;

    const generateFanBin = (cx, cy, offsetAngle) => {
      const buffer = new ArrayBuffer(POLAR_ROWS * HALF_LEDS * 2);
      const view = new DataView(buffer);
      
      // Draw overlay on canvas for visualization
      ctx.beginPath();
      ctx.arc(cx, cy, HALF_LEDS * scale, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      let degrees = 0;
      let byteOffset = 0;
      for (let row = 0; row < POLAR_ROWS; row++) {
        const effectiveDeg = (degrees + parseFloat(offsetAngle)) % 360;
        const rad = (effectiveDeg * Math.PI) / 180.0;

        for (let j = 0; j < HALF_LEDS; j++) {
          const r = HALF_LEDS - j;
          const dx = r * Math.sin(rad);
          const dy = r * Math.cos(rad);
          const px = cx + dx * scale;
          const py = cy - dy * scale;

          const [r8, g8, b8] = getPixel(px, py);
          const rgb565 = rgbToRgb565(r8, g8, b8);
          
          view.setUint16(byteOffset, rgb565, true); // little endian
          byteOffset += 2;
        }
        degrees += 6;
      }
      return new Blob([buffer], { type: 'application/octet-stream' });
    };

    const bin1 = generateFanBin(center1_x, center1_y, angle1);
    const bin2 = generateFanBin(center2_x, center2_y, angle2);

    setBins({ fan1: bin1, fan2: bin2 });
    setStatus({ state: 'success', msg: 'Files Ready for Upload' });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setImageSrc(url);
      };
      img.src = url;
    }
  };

  const handleEspUpload = async (fanNum) => {
    if (!bins) return;
    setStatus({ state: 'processing', msg: `Uploading to Fan ${fanNum}...` });
    
    try {
      const formData = new FormData();
      if (fanNum === 1) {
        formData.append('file', bins.fan1, 'fan1.bin');
      } else {
        formData.append('file', bins.fan2, 'fan2.bin');
      }

      // Send to typical default AP IP for ESP32: 192.168.4.1
      const espUrl = 'http://192.168.4.1/upload';
      
      await fetch(espUrl, { method: 'POST', body: formData, mode: 'no-cors' });
      
      setStatus({ state: 'success', msg: `Upload to Fan ${fanNum} Complete!` });
    } catch (err) {
      console.error(err);
      setStatus({ state: 'error', msg: `Upload Failed. Connect to HologramFan${fanNum} Wi-Fi!` });
    }
  };

  return (
    <div className="app-container">
      <div className="panel controls-panel">
        <h1>Hologram Array</h1>
        
        <div className="file-input-wrapper">
          <button className="btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Select Image
          </button>
          <input type="file" accept="image/*" onChange={handleImageUpload} />
        </div>

        <div className="control-group">
          <label><span>Distance between centers</span> <span>{distance} cm</span></label>
          <input type="range" min="10" max="60" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </div>

        <div className="control-group">
          <label><span>Overlap</span> <span>{overlap} cm</span></label>
          <input type="range" min="0" max="30" value={overlap} onChange={(e) => setOverlap(e.target.value)} />
        </div>

        <div className="control-group">
          <label><span>Fan 1 Angle Offset</span> <span>{angle1}°</span></label>
          <input type="range" min="0" max="360" value={angle1} onChange={(e) => setAngle1(e.target.value)} />
        </div>

        <div className="control-group">
          <label><span>Fan 2 Angle Offset</span> <span>{angle2}°</span></label>
          <input type="range" min="0" max="360" value={angle2} onChange={(e) => setAngle2(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto' }}>
          <button 
            className="btn btn-upload" 
            disabled={!bins} 
            onClick={() => handleEspUpload(1)}
            style={{ opacity: !bins ? 0.5 : 1 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            Upload Fan 1
          </button>

          <button 
            className="btn btn-upload" 
            disabled={!bins} 
            onClick={() => handleEspUpload(2)}
            style={{ opacity: !bins ? 0.5 : 1 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            Upload Fan 2
          </button>
        </div>
      </div>

      <div className="panel preview-panel">
        <div className="status-badge">
          <div className={`status-dot ${status.state}`}></div>
          {status.msg}
        </div>
        <div className="preview-canvas-container">
          {!imageSrc && <span style={{color: 'var(--text-muted)'}}>No image selected</span>}
          <canvas ref={canvasRef} style={{ display: imageSrc ? 'block' : 'none' }}></canvas>
        </div>
      </div>
    </div>
  );
}
