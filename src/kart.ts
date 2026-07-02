// Kart physics: scalar speed along a heading, arcade-simple (no drift/lateral
// velocity in this milestone). Position integration must use the same
// forward-axis convention as mode7.ts's renderGround: forward = (cos, sin).

import type { Input } from './input.js';

const ACCEL = 420; // world units / s^2
const BRAKE = 560; // world units / s^2 (applies whether slowing forward or speeding up reverse)
const MAX_SPEED = 420; // world units / s, on-road
const MAX_SPEED_OFFROAD = 180; // world units / s, off-road cap
const MAX_REVERSE = 200; // world units / s
const STEER = 2.6; // rad / s, at full speed
const STEER_REF_SPEED = 80; // speed at which steering reaches full rate
const FRICTION = 0.98; // per-frame-equivalent decay factor, applied as ^dt below, on-road
const FRICTION_OFFROAD = 0.9; // stronger decay off-road

export interface Kart {
  x: number;
  y: number;
  heading: number;
  speed: number;
}

export function createKart(startX = 0, startY = 0, startHeading = 0): Kart {
  return { x: startX, y: startY, heading: startHeading, speed: 0 };
}

export function updateKart(kart: Kart, input: Input, onRoad: boolean, dt: number): void {
  // Accelerate / brake-reverse.
  if (input.up) kart.speed += ACCEL * dt;
  if (input.down) kart.speed -= BRAKE * dt;

  // Friction/drag decays speed every frame; stronger off-road.
  const friction = onRoad ? FRICTION : FRICTION_OFFROAD;
  kart.speed *= Math.pow(friction, dt * 60);
  if (Math.abs(kart.speed) < 0.5) kart.speed = 0;

  // Clamp to road/off-road speed caps.
  const maxSpeed = onRoad ? MAX_SPEED : MAX_SPEED_OFFROAD;
  if (kart.speed > maxSpeed) kart.speed = maxSpeed;
  if (kart.speed < -MAX_REVERSE) kart.speed = -MAX_REVERSE;

  // Steering: no effect while parked, scales up to full rate by STEER_REF_SPEED.
  const steerScale = Math.min(Math.abs(kart.speed) / STEER_REF_SPEED, 1);
  const steerDir = kart.speed < 0 ? -1 : 1; // reversing steers the opposite way
  if (input.left) kart.heading += STEER * dt * steerScale * steerDir;
  if (input.right) kart.heading -= STEER * dt * steerScale * steerDir;

  // Integrate position — forward axis matches mode7.ts's (cos, sin).
  kart.x += Math.cos(kart.heading) * kart.speed * dt;
  kart.y += Math.sin(kart.heading) * kart.speed * dt;
}
