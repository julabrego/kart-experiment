// Keyboard state: arrows + WASD. Uses e.code so it's layout-independent
// (WASD keeps working on non-QWERTY layouts).

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

type InputField = keyof Input;

const KEY_MAP: Record<string, InputField> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

const ARROW_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createInput(): Input {
  const input: Input = { up: false, down: false, left: false, right: false };

  window.addEventListener('keydown', (e) => {
    const field = KEY_MAP[e.code];
    if (field) input[field] = true;
    if (ARROW_CODES.has(e.code)) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    const field = KEY_MAP[e.code];
    if (field) input[field] = false;
    if (ARROW_CODES.has(e.code)) e.preventDefault();
  });

  return input;
}
