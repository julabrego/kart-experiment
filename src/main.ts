import { buildTrack, isOnRoad, type Track } from './track.js';
import { renderGround, CAM_HEIGHT, type Camera } from './mode7.js';
import { createInput, type Input } from './input.js';
import { createKart, updateKart, type Kart } from './kart.js';

const CAM_BACK = 90; // world units behind the kart

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let imageData: ImageData;
let track: Track;
let input: Input;
let kart: Kart;
let cam: Camera;
let lastTime = 0;
let fps = 0;
let fpsAccum = 0;
let fpsFrames = 0;

function init(): void {
  canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2d context unavailable');
  ctx = context;
  imageData = ctx.createImageData(canvas.width, canvas.height);

  track = buildTrack();
  input = createInput();
  kart = createKart(track.startX, track.startY, track.startHeading);
  cam = { x: 0, y: 0, heading: 0, height: CAM_HEIGHT };
  updateCamera();

  requestAnimationFrame(frame);
}

function updateCamera(): void {
  cam.heading = kart.heading;
  cam.x = kart.x - Math.cos(kart.heading) * CAM_BACK;
  cam.y = kart.y - Math.sin(kart.heading) * CAM_BACK;
}

function frame(now: number): void {
  const dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const onRoad = isOnRoad(track, kart.x, kart.y);
  updateKart(kart, input, onRoad, dt);
  updateCamera();

  renderGround(imageData, cam, track);
  ctx.putImageData(imageData, 0, 0);
  drawKartSprite();
  drawHud(onRoad, dt);

  requestAnimationFrame(frame);
}

// Camera sits directly behind the kart, so the kart itself is always at a
// fixed screen position facing away from us. A world-space sprite projection
// isn't needed until opponents show up — draw a static placeholder instead.
function drawKartSprite(): void {
  const cx = canvas.width / 2;
  const baseY = canvas.height - 60;

  ctx.fillStyle = '#d94b4b';
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 34);
  ctx.lineTo(cx - 26, baseY + 20);
  ctx.lineTo(cx + 26, baseY + 20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#222222';
  ctx.fillRect(cx - 30, baseY + 16, 14, 10);
  ctx.fillRect(cx + 16, baseY + 16, 14, 10);
}

function drawHud(onRoad: boolean, dt: number): void {
  if (dt > 0) {
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      fps = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('speed: ' + Math.round(kart.speed), 12, 12);
  ctx.fillText('fps: ' + fps, 12, 32);

  if (!onRoad) {
    ctx.fillStyle = '#ffcc00';
    ctx.fillText('OFF-ROAD', 12, 52);
  }
}

init();
