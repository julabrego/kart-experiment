// Procedural track: a closed road loop over a green field, plus a checkered
// start line. Built once into an offscreen canvas and cached as a raw
// Uint8ClampedArray, same pattern the old prototype used for its tile image
// (offscreen canvas -> getImageData -> cached pixel buffer) — see MATH.md.

export const MAP_W = 1024;
export const MAP_H = 1024;

const FIELD_COLOR = '#3a7d3a';
const ROAD_COLOR = '#666666';
const CURB_COLOR = '#4a4a4a';
const ROAD_WIDTH = 160;
const CURB_WIDTH = ROAD_WIDTH + 24;

// Center + radii of the road loop (an ellipse), in map pixels.
const CX = MAP_W / 2;
const CY = MAP_H / 2;
const RX = MAP_W * 0.32;
const RY = MAP_H * 0.32;

export interface Track {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  startX: number;
  startY: number;
  startHeading: number;
}

// Builds the track once, returns the cached pixel buffer plus the map size
// and a world-space anchor for where the kart should start (on the road,
// facing along it).
export function buildTrack(): Track {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  // Field.
  ctx.fillStyle = FIELD_COLOR;
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  // Road loop: darker/wider curb stroke first, then the lighter road on top,
  // so the curb reads as an edge outline.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = CURB_COLOR;
  ctx.lineWidth = CURB_WIDTH;
  strokeLoop(ctx);
  ctx.strokeStyle = ROAD_COLOR;
  ctx.lineWidth = ROAD_WIDTH;
  strokeLoop(ctx);

  // Checkered start line: a band across the road at the top of the loop
  // (angle = -PI/2, i.e. straight up from center).
  drawStartLine(ctx);

  const pixels = ctx.getImageData(0, 0, MAP_W, MAP_H).data;

  // Start position sits on the road at the top of the loop, heading along
  // the loop's tangent there (loop runs clockwise as angle increases, so at
  // the top the tangent points in +X — see kart.ts/mode7.ts heading convention).
  const startX = CX;
  const startY = CY - RY;
  const startHeading = 0;

  return { pixels, width: MAP_W, height: MAP_H, startX, startY, startHeading };
}

function strokeLoop(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawStartLine(ctx: CanvasRenderingContext2D): void {
  const squares = 6;
  const bandLen = ROAD_WIDTH; // along the road direction (tangent, ~+X here)
  const squareSize = bandLen / squares;
  const topY = CY - RY - ROAD_WIDTH / 2;
  const leftX = CX - bandLen / 2;

  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#eeeeee';
    ctx.fillRect(leftX + i * squareSize, topY, squareSize, ROAD_WIDTH);
  }
}

// Samples the track at a wrapped world coordinate and reports whether it's
// road/curb (true) or field (false). Used for the off-track slowdown.
export function isOnRoad(track: Track, wx: number, wy: number): boolean {
  const w = track.width, h = track.height;
  let tx = Math.floor(wx) % w;
  let ty = Math.floor(wy) % h;
  if (tx < 0) tx += w;
  if (ty < 0) ty += h;

  const idx = (ty * w + tx) * 4;
  const r = track.pixels[idx] ?? 0;
  const g = track.pixels[idx + 1] ?? 0;
  const b = track.pixels[idx + 2] ?? 0;

  // Field is green-dominant (g > r and g > b); anything else (road, curb,
  // start-line checkers) counts as "on road".
  const isField = g > r + 15 && g > b + 15;
  return !isField;
}
