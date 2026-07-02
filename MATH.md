# Math behind the fake-3D tiled floor

> **Note:** the live renderer has since moved to a per-scanline Mode 7
> sampler (`src/mode7.js`) to support a moving/driving camera — see
> `src/kart.js` and `src/main.js`. This document describes the original
> homography-based prototype, kept here for reference since the
> projective-geometry ideas (§2) still apply.

No WebGL. No 3D scene graph. Two math steps only:

1. **Corner projection** — turn camera state (`yaw`, `pitch`, `dist`) into 4
   screen points. This is the only place "3D" concepts appear (rotation,
   perspective divide), and it only ever touches 4 points.
2. **Inverse homography fill** — given those 4 screen points, figure out,
   for every pixel inside the resulting quad, which point of the *source
   tile* it corresponds to. This is pure 2D projective geometry, applied
   ~480,000 times per frame (800×600).

---

## 0. Before you start: the basic math you'll need

If `sine`, `matrix`, or `determinant` sound distant, read this first. These
five ideas are enough to follow the rest of the document.

### 0a. A point is just a pair (or triple) of numbers

`(x, y)` is a point on a plane: `x` how far right, `y` how far up. `(x, y,
z)` is the same but in 3D, adding `z` = depth (how far forward/back).
Everything below is just moving, rotating, or squashing these pairs/triples
of numbers — nothing more mystical than that.

### 0b. Sine and cosine: the bicycle wheel reflector

Picture a point spinning around a circle of radius 1, like the reflector
on a bicycle wheel. If `θ` is the angle it has turned from the right side:

```
x = cos(θ)   ← "how far right the reflector is"
y = sin(θ)   ← "how far up the reflector is"
```

That's the whole idea. `sin` and `cos` are just the coordinates of a
spinning point. Whenever the code rotates something by an angle `yaw` or
`pitch`, it's really asking "where does this point land if I spin it `θ`
degrees around the center?" — and the answer is always written with sines
and cosines.

### 0c. A matrix is a "machine" that transforms points

It's nothing more than a table of numbers that says "multiply this by
every point and you get a new point." For example, this recipe:

```
x' = a*x + b*y
y' = c*x + d*y
```

is written compactly as a matrix:

```
[x']   [a  b] [x]
[y'] = [c  d] [y]
```

It's literally the same arithmetic, just shorter notation. A "rotation
matrix" is a table of numbers *already built* out of sines and cosines,
such that multiplying it by a point gives back that same point rotated by
an angle `θ`:

```
[cos θ  -sin θ]
[sin θ   cos θ]
```

You don't need to memorize why this exact formula rotates — it's enough to
trust it's the standard recipe (it comes from the trigonometry in 0b) and
recognize it when it shows up in the code.

### 0d. Dividing by depth is what makes perspective

Think of a photo: a car far away looks tiny, the same car close up looks
huge. The rule is "size in the photo = real size / distance". So whenever
you see something like this anywhere in this document:

```
screen = focal * coordinate / z
```

it's exactly that idea: `z` is "how far away", and dividing by a big
number (far) gives a small result (looks small on screen); dividing by a
small number (close) gives a big result (looks big on screen). This one
step — dividing by depth — is *the* difference between drawing something
"flat" and giving it a 3D feel.

### 0e. Homogeneous coordinates: the trick to fit perspective into a matrix

A plain matrix (like the one in 0c) can only rotate/stretch — it can't
"divide by z" or move points (translate). The **homogeneous coordinates**
trick is to add one extra number `w` to every point: instead of `(x, y)`
we use `(x, y, w)`, and at the very end we always do:

```
x_real = x / w
y_real = y / w
```

As long as `w = 1`, nothing special happens. But if a 3×3 matrix makes `w`
end up different from 1 (say, `w` depends on the input `x` or `y`), then
that final divide *is* perspective. This is exactly what the bottom row
`[g h 1]` of a homography does (see `§2`): it lets `w` vary depending on
the point, which is what warps a square into a trapezoid.

### 0f. Determinant: one number that says whether a matrix "can be undone"

The **determinant** of a matrix is a single number that comes out of
combining its entries in a specific way (there's a formula, no need to
invent it). All that matters for this document:

- If the determinant is `0`, the matrix "flattens" space (for example, it
  squashes an entire plane down to a single line) and **cannot be
  inverted** — there's no way to go back and recover the original point.
- If it's not `0`, an "inverse" matrix exists that exactly undoes what the
  original did. That's why `§2b` computes a determinant: it's the
  mandatory check before the homography can be inverted.

With these six ideas (point, sine/cosine, matrix, dividing by depth,
homogeneous coordinates, determinant) you can read the rest of this
document line by line without any magic left in it.

---

## 1. Corner projection — `projectCorners()`

The rectangle lives on a ground plane in a fake 3D world, centered at the
origin:

```js
var corners3d = [
  [-hw, 0, -hh],
  [hw, 0, -hh],
  [hw, 0, hh],
  [-hw, 0, hh]
];
```

Each corner is `(x, y, z)` with `y = 0` (flat on the ground). `x` is
left/right, `z` is forward/back, `y` is up/down. Four corners, one per
rectangle vertex.

### 1a. Yaw — rotate around the vertical axis

```js
var x = p[0] * cosY - p[2] * sinY;
var z0 = p[0] * sinY + p[2] * cosY;
```

Standard 2D rotation matrix, applied to the `(x, z)` plane (the ground
plane, viewed from above):

```
[x']   [cosY  -sinY] [x]
[z'] = [sinY   cosY] [z]
```

`yaw` is the angle the camera has orbited around the rectangle. Rotating
the *rectangle* by `-yaw` is equivalent to rotating the *camera* by `+yaw`
around it — same visual result, cheaper to compute (rectangle has 4 points,
camera has none). This is why dragging left/right spins the floor.

**Plain terms (see `§0b`/`§0c`):** this is just the bicycle-wheel rotation
matrix, applied to the `(x, z)` plane instead of `(x, y)`. If you were
standing looking straight down at the floor, `yaw` is how many degrees the
whole drawing spins, and `cosY`/`sinY` are the coordinates of the
"reflector" that marks that rotation.

### 1b. Pitch — tilt the plane toward/away from the camera, then push back

```js
var y2 = y * cosP - z0 * sinP;
var z = y * sinP + z0 * cosP + cam.dist;
```

Same rotation matrix shape, this time mixing the (already-yawed) `z0` with
the vertical `y`:

```
[y2]   [cosP  -sinP] [y ]
[z ] = [sinP   cosP] [z0]      then z += dist
```

Because every corner has `y = 0` before this step, this rotation is what
actually produces perspective: it's what tilts the "far" edge of the
rectangle up in `y2` (screen-up) while pushing its `z` (depth) further from
the camera. `dist` is then just added to `z` — moving the whole plane away
from the camera. That's the "zoom" (dolly) knob:

```
scroll → cam.dist *= 1.1 or 0.9  → whole plane recedes/approaches
```

**Plain terms:** `pitch` is the same rotation idea from `§1a`, just tilting
the plane "backward" instead of spinning it "sideways" — like reclining a
chair. And `dist` is simply "how many meters further away to put
everything", so it's added straight into the depth `z`. The further away,
the smaller everything will look once we get to `§1c` (recall `§0d`:
dividing by a big `z` gives a small result).

### 1c. Pinhole projection — 3D point → 2D screen pixel

```js
var sx = (FOCAL * x) / z + cx;
var sy = (FOCAL * y2) / z + cy;
```

This is the classic pinhole camera equation:

```
screen = focal_length * (world_coord / depth) + center
```

Dividing by `z` (depth) is *the* perspective step — it's why points farther
away (`z` large) land closer to the vanishing point `(cx, cy)`, and points
closer (`z` small) spread out more. `FOCAL = 500` just controls field of
view (bigger = narrower/zoomier lens).

**Plain terms:** this is exactly the photo formula from `§0d` (`size in
photo = real size / distance`), with two practical extras: `FOCAL` is a
general scale factor (like lens zoom: it enlarges or shrinks everything
equally) and `+ cx`/`+ cy` simply shifts the result so the "optical
center" (`0,0` in the formula) lands in the middle of the screen instead
of the top-left corner. Without that `+cx, +cy`, the image would
technically still be "in perspective" but shoved off-screen.

Output of this whole function: 4 pairs `(sx, sy)` — plain 2D screen pixels.
Everything below never touches 3D again.

### Diagram — world rectangle → screen trapezoid

<svg viewBox="0 0 780 380" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:780px">
  <style>
    .lbl { font: 13px monospace; fill: #333; }
    .lbl2 { font: 12px monospace; fill: #666; }
    .axis { stroke: #999; stroke-width: 1; }
    .rect3d { fill: none; stroke: #2b7de9; stroke-width: 2; }
    .proj { fill: none; stroke: #999; stroke-dasharray: 3 3; stroke-width: 1; }
    .trap { fill: #ffe9b3; stroke: #d99a1b; stroke-width: 2; }
  </style>
  <!-- LEFT: world (top-down-ish) view -->
  <text x="10" y="20" class="lbl">world (ground plane, y=0), before projection</text>
  <line x1="40" y1="150" x2="330" y2="150" class="axis"/>
  <text x="335" y="154" class="lbl2">x</text>
  <line x1="185" y1="230" x2="185" y2="40" class="axis"/>
  <text x="170" y="35" class="lbl2">z (depth)</text>
  <!-- rectangle corners p0..p3 (before yaw, axis-aligned) -->
  <polygon points="125,110 245,110 245,190 125,190" class="rect3d" stroke-dasharray="4 3"/>
  <text x="100" y="105" class="lbl2">p0(-hw,0,-hh)</text>
  <text x="250" y="105" class="lbl2">p1(hw,0,-hh)</text>
  <text x="250" y="205" class="lbl2">p2(hw,0,hh)</text>
  <text x="95" y="205" class="lbl2">p3(-hw,0,hh)</text>
  <!-- yawed rectangle -->
  <polygon points="140,90 260,130 220,220 100,180" class="rect3d"/>
  <text x="330" y="90" class="lbl2">↑ same rect after yaw</text>
  <text x="330" y="106" class="lbl2">  rotation (§1a)</text>
  <!-- camera eye -->
  <circle cx="185" cy="330" r="4" fill="#c0392b"/>
  <text x="150" y="348" class="lbl2">camera eye (dist behind plane)</text>
  <line x1="185" y1="330" x2="140" y2="90" class="proj"/>
  <line x1="185" y1="330" x2="260" y2="130" class="proj"/>
  <line x1="185" y1="330" x2="220" y2="220" class="proj"/>
  <line x1="185" y1="330" x2="100" y2="180" class="proj"/>
  <!-- arrow to right diagram -->
  <line x1="360" y1="200" x2="410" y2="200" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/>
  <text x="358" y="190" class="lbl2">pinhole divide by z (§1c)</text>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
    </marker>
  </defs>
  <!-- RIGHT: resulting screen trapezoid -->
  <text x="440" y="20" class="lbl">screen space (after sx = FOCAL*x/z + cx)</text>
  <polygon points="470,90 700,100 730,270 450,250" class="trap"/>
  <text x="440" y="85" class="lbl2">s0</text>
  <text x="705" y="95" class="lbl2">s1</text>
  <text x="735" y="270" class="lbl2">s2</text>
  <text x="415" y="255" class="lbl2">s3</text>
  <text x="470" y="300" class="lbl2">far edge (s0-s1) shorter — vanishing-point effect</text>
  <text x="470" y="316" class="lbl2">near edge (s3-s2) longer — closer to camera</text>
</svg>

The dashed lines are the actual sight-lines from the camera eye through each
world corner — where they cross the "screen" (the divide-by-`z` step) is
`(sx, sy)`. Same rectangle, but the far edge (`s0-s1`) is compressed toward
the vanishing point and the near edge (`s3-s2`) stays wide: that's the
trapezoid the homography has to fill.

---

## 2. Inverse homography — mapping screen pixels back to tile UV

We now have a screen quad (4 corners, generally a trapezoid, not a
rectangle — that's the deformation the user sees). We need: for pixel
`(px, py)` inside that quad, which `(u, v) ∈ [0,1]×[0,1]` of the *source
tile* does it sample?

A **homography** is the general 3×3 projective transform:

```
[x]   [a  b  c] [u]
[y] = [d  e  f] [v]
[w]   [g  h  1] [1]

screen_x = x / w,  screen_y = y / w
```

When `g = h = 0` this degrades to an affine map (parallelogram). Nonzero
`g, h` are exactly what let a *square* map to a *trapezoid* — which is
required here, since the projected floor is a trapezoid, not a
parallelogram, whenever the camera looks at an angle.

**Plain terms (see `§0e`):** that bottom row `[g h 1]` is exactly the
homogeneous-coordinates trick. `w = g*u + h*v + 1` — if `g` and `h` are
zero, `w` is always `1` and nothing special happens (it's a "straight"
map, no perspective: a square gives a parallelogram). But if `g` or `h`
are nonzero, `w` changes depending on where you are in the square (`u,v`),
and since the final step divides by `w`, different parts of the square get
shrunk or stretched differently — that's what turns a neat square into a
trapezoid with one side narrower than the other. It's the same
divide-by-depth idea from `§0d`/`§1c`, except now the "depth" (`w`) isn't
coming from a 3D world — it's manufactured on purpose with `g, h` to get
the right effect in 2D.

### Diagram — unit square ↔ screen trapezoid

<svg viewBox="0 0 780 300" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:780px">
  <style>
    .lbl { font: 13px monospace; fill: #333; }
    .lbl2 { font: 12px monospace; fill: #666; }
    .grid { stroke: #bcd; stroke-width: 1; }
    .sq { fill: #eef4ff; stroke: #2b7de9; stroke-width: 2; }
    .trap2 { fill: #ffe9b3; stroke: #d99a1b; stroke-width: 2; }
  </style>
  <!-- LEFT: source unit square (u,v) with tile grid -->
  <text x="40" y="20" class="lbl">source tile, (u,v) in [0,1]x[0,1]</text>
  <rect x="60" y="40" width="200" height="200" class="sq"/>
  <!-- repeat grid lines to hint tiling -->
  <line x1="60" y1="90" x2="260" y2="90" class="grid"/>
  <line x1="60" y1="140" x2="260" y2="140" class="grid"/>
  <line x1="60" y1="190" x2="260" y2="190" class="grid"/>
  <line x1="110" y1="40" x2="110" y2="240" class="grid"/>
  <line x1="160" y1="40" x2="160" y2="240" class="grid"/>
  <line x1="210" y1="40" x2="210" y2="240" class="grid"/>
  <text x="30" y="35" class="lbl2">(0,0)</text>
  <text x="265" y="35" class="lbl2">(1,0)</text>
  <text x="265" y="255" class="lbl2">(1,1)</text>
  <text x="30" y="255" class="lbl2">(0,1)</text>
  <circle cx="60" cy="40" r="3" fill="#2b7de9"/>
  <circle cx="260" cy="40" r="3" fill="#2b7de9"/>
  <circle cx="260" cy="240" r="3" fill="#2b7de9"/>
  <circle cx="60" cy="240" r="3" fill="#2b7de9"/>
  <!-- arrows both directions -->
  <line x1="290" y1="110" x2="380" y2="110" stroke="#333" stroke-width="2" marker-end="url(#arrow2)"/>
  <text x="292" y="100" class="lbl2">H  (build, §2a)</text>
  <line x1="380" y1="170" x2="290" y2="170" stroke="#333" stroke-width="2" marker-end="url(#arrow2)"/>
  <text x="292" y="190" class="lbl2">Hinv  (used per-pixel, §2c)</text>
  <defs>
    <marker id="arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
    </marker>
  </defs>
  <!-- RIGHT: destination trapezoid (screen), same corner correspondence -->
  <text x="440" y="20" class="lbl">destination: screen trapezoid dst[0..3]</text>
  <polygon points="470,60 690,75 720,230 450,215" class="trap2"/>
  <circle cx="470" cy="60" r="3" fill="#d99a1b"/>
  <circle cx="690" cy="75" r="3" fill="#d99a1b"/>
  <circle cx="720" cy="230" r="3" fill="#d99a1b"/>
  <circle cx="450" cy="215" r="3" fill="#d99a1b"/>
  <text x="420" y="55" class="lbl2">dst0=(x0,y0)</text>
  <text x="695" y="70" class="lbl2">dst1=(x1,y1)</text>
  <text x="725" y="230" class="lbl2">dst2=(x2,y2)</text>
  <text x="380" y="220" class="lbl2">dst3=(x3,y3)</text>
  <text x="440" y="265" class="lbl2">(0,0)→dst0, (1,0)→dst1, (1,1)→dst2, (0,1)→dst3</text>
</svg>

`H` is *built once per frame* from the 4 corner correspondences (`§2a`).
`Hinv` is then evaluated *once per pixel* inside the render loop (`§2c`) —
same matrix, opposite direction: given a screen pixel, which `(u,v)` lit it.

### 2a. Solving for the homography — `computeHomography(dst)`

We want `H` such that the unit square `(0,0) (1,0) (1,1) (0,1)` maps to the
4 screen corners `dst[0..3]`. The code uses the closed-form solution
(Heckbert's square-to-quad):

```js
var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
```

`dx3, dy3` measure how far the quad deviates from being a parallelogram
(if `dst` were a true parallelogram, `x0 - x1 + x2 - x3 = 0`). That
deviation is exactly what's solved for `g, h`:

```js
var den = dx1 * dy2 - dx2 * dy1;
g = (dx3 * dy2 - dx2 * dy3) / den;
h = (dx1 * dy3 - dx3 * dy1) / den;
```

(`den` is a 2×2 determinant — Cramer's rule for the 2-equation, 2-unknown
system `dx3 = g*dx1 + h*dx2`, `dy3 = g*dy1 + h*dy2`.)

Once `g, h` are known, `a..f` follow directly by matching the other 3
corners:

```js
var a = x1 - x0 + g * x1;
var b = x3 - x0 + h * x3;
var c = x0;
var d = y1 - y0 + g * y1;
var e = y3 - y0 + h * y3;
var f = y0;
```

(`c = x0, f = y0` because plugging `u=v=0` into the homography must give
corner 0 directly.)

**Plain terms:** you don't need to trace every algebra step by hand. The
whole idea of `§2a` is: "I have 4 input points (the square's corners `0,0
/ 1,0 / 1,1 / 0,1`, always the same) and 4 output points (`dst[0..3]`, the
screen corners that came out of `§1`). I want *the* matrix that sends each
input exactly to its matching output." Since that's 4 points with `x` and
`y` each, that's 8 equations, and the homography has 8 free numbers (`a`
through `h`, with `i` fixed at `1`) — so there's always exactly *one*
solution, neither underdetermined nor overdetermined. The code above is
simply those 8 equations solved by hand ahead of time, already simplified
into direct formulas so we don't have to invert a big matrix every frame.

### 2b. Inverting it — `invertHomography(H)`

`H` maps `uv → screen`. We need the opposite direction for filling pixels,
so we invert the 3×3 matrix using the adjugate/cofactor method:

```js
var A = e * i - f * h;   // cofactors ...
...
var det = a * A + b * B + c * C;   // = determinant, via cofactor expansion
var inv = 1 / det;
return [A*inv, D*inv, G*inv, ...];  // adjugate^T / det
```

This is textbook `inverse = adjugate(M) / det(M)` for a 3×3 matrix — no
shortcuts, just the general formula, since a homography isn't guaranteed
orthogonal/special in any way that would let us skip it.

**Plain terms (see `§0f`):** inverting a matrix means asking "if I have
the result, how do I get back to the original point?" `H` turns
`(u,v) → screen`; for rendering we need the opposite,
`screen → (u,v)`, so `H` has to be inverted. The `det` (determinant) is
the number you first need to check "yes, we can go back" (if it were `0`,
`H` would have flattened the square into a line and there'd be no way to
recover `u,v` from a pixel). Once we know it's possible, the adjugate
formula is just the mechanical recipe for computing each number of the
inverse matrix — no hidden trick, it's the exact same formula you'd use by
hand on paper.

### 2c. Per-pixel sampling — the render loop

```js
var w = g * px + h * py + iH;
var u = (a * px + b * py + c) / w;
var v = (d * px + e * py + f) / w;
```

This is `Hinv` applied to homogeneous screen point `(px, py, 1)`, then
dehomogenized (divide by `w`) — same pinhole-style divide as step 1c, just
now going screen → texture instead of world → screen. This divide is what
makes the sampling *perspective-correct*: without it (i.e. naive affine
interpolation of `u,v` across the quad) tiles would visibly warp/curve
instead of receding correctly in straight lines — the classic PS1-era
texture-warp artifact this code avoids.

```js
if (u < 0 || u > 1 || v < 0 || v > 1) continue;
```

Outside the unit square = outside the rectangle = skip (transparent/black).

### 2d. Tiling ("in loop")

```js
var tx = ((u * REPEAT * tileW) | 0) % tileW;
var ty = ((v * REPEAT * tileH) | 0) % tileH;
```

`u ∈ [0,1]` is scaled up by `REPEAT` (copies across the rectangle) and by
`tileW` (pixels per copy), then wrapped with `% tileW`. This is what makes
the single tile image repeat seamlessly across the whole rectangle instead
of stretching once — the "in loop" requirement.

---

## Summary of the causal chain

```
mouse drag  → cam.yaw, cam.pitch     (§1a, §1b — rotation matrices)
mouse wheel → cam.dist               (§1b — added to depth)
              ↓
projectCorners()                     (§1c — pinhole divide, 4 points only)
              ↓
4 screen corners (a trapezoid)
              ↓
computeHomography() → invertHomography()   (§2a, §2b — projective algebra)
              ↓
per-pixel: screen(px,py) → Hinv → (u,v)    (§2c — perspective-correct divide)
              ↓
(u,v) → wrap by REPEAT/tileW,tileH → tile pixel   (§2d — the loop)
```

Everything past `projectCorners()` is 2D linear/projective algebra on a
flat pixel grid — no z-buffer, no 3D rasterizer, no matrices bigger than
3×3. The "3D" feel is entirely the byproduct of steps 1b/1c (perspective
divide) shaping 4 points into a trapezoid, and step 2c reproducing that
same kind of divide per-pixel so the texture inside warps consistently
with it.

---

## References

- [3D Math Primer for Graphics and Game Development](https://gamemath.com/book/) —
  Fletcher Dunn & Ian Parberry. Free full text. Covers vectors, matrices,
  homogeneous coordinates, and perspective projection in much more depth
  than `§0` here — good next step if you want the full picture behind
  `§1`/`§2`. Chapters 1, 4, 7, and 10 map closest to this document.
