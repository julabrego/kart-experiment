// Per-scanline Mode 7 ground renderer.
//
// Replaces the old prototype's world-fixed-rectangle + homography approach
// (see MATH.md / MATH.es.md for that original pipeline). A moving camera
// over a large/looping track is much simpler this way: each screen row below
// the horizon corresponds to one ground depth, and within a row the
// world-space traversal is a plain affine step (no per-pixel divide).
//
// Camera pose: cam = { x, y, heading, height }
//   x, y      - world position (map pixel units)
//   heading   - radians, forward axis = (cos(heading), sin(heading))
//   height    - camera height above the ground plane
//
// Handedness convention (must match kart.ts's position integration):
//   forward axis = (cos(heading),  sin(heading))
//   right axis   = (sin(heading), -cos(heading))

import type { Track } from './track.js';

export const FOCAL = 500;
export const CAM_HEIGHT = 220;
export const HORIZON_FRAC = 0.42;

const SKY_COLOR: readonly [number, number, number] = [0x87, 0xce, 0xeb]; // light sky blue

export interface Camera {
  x: number;
  y: number;
  heading: number;
  height: number;
}

export function renderGround(imageData: ImageData, cam: Camera, track: Track): void {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const horizonY = Math.floor(H * HORIZON_FRAC);

  // Sky: single block fill above the horizon, no per-pixel sampling.
  const skyRows = Math.max(0, horizonY);
  for (let py = 0; py < skyRows; py++) {
    const rowBase = py * W * 4;
    for (let px = 0; px < W; px++) {
      const i = rowBase + px * 4;
      data[i] = SKY_COLOR[0];
      data[i + 1] = SKY_COLOR[1];
      data[i + 2] = SKY_COLOR[2];
      data[i + 3] = 255;
    }
  }

  const trackPixels = track.pixels;
  const mapW = track.width;
  const mapH = track.height;
  const camX = cam.x;
  const camY = cam.y;
  const camHeight = cam.height;
  const cs = Math.cos(cam.heading);
  const sn = Math.sin(cam.heading);
  const halfW = W / 2;

  for (let py = Math.max(horizonY, 0); py < H; py++) {
    const rowFromHorizon = py - horizonY;
    if (rowFromHorizon <= 0) continue; // avoid divide-by-zero right at the horizon

    const depth = (camHeight * FOCAL) / rowFromHorizon;
    const scale = depth / FOCAL;

    let wx = camX + cs * depth - sn * (halfW * scale);
    let wy = camY + sn * depth + cs * (halfW * scale);
    const stepX = sn * scale;
    const stepY = -cs * scale;

    const rowBase = py * W * 4;
    for (let px = 0; px < W; px++) {
      let tx = (wx | 0) % mapW;
      let ty = (wy | 0) % mapH;
      if (tx < 0) tx += mapW;
      if (ty < 0) ty += mapH;

      const srcIdx = (ty * mapW + tx) * 4;
      const dstIdx = rowBase + px * 4;
      data[dstIdx] = trackPixels[srcIdx] ?? 0;
      data[dstIdx + 1] = trackPixels[srcIdx + 1] ?? 0;
      data[dstIdx + 2] = trackPixels[srcIdx + 2] ?? 0;
      data[dstIdx + 3] = 255;

      wx += stepX;
      wy += stepY;
    }
  }
}
