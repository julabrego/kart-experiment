# Matemática detrás del suelo con tiles falso-3D

Sin WebGL. Sin escena 3D. Solo dos pasos matemáticos:

1. **Proyección de esquinas** — convierte el estado de cámara (`yaw`,
   `pitch`, `dist`) en 4 puntos de pantalla. Es el único lugar donde
   aparecen conceptos "3D" (rotación, división perspectiva), y solo toca 4
   puntos.
2. **Relleno por homografía inversa** — dados esos 4 puntos de pantalla,
   averiguar, para cada píxel dentro del cuadrilátero resultante, a qué
   punto del *tile origen* corresponde. Esto es geometría proyectiva 2D
   pura, aplicada ~480.000 veces por frame (800×600).

---

## 0. Antes de arrancar: la matemática básica que vas a necesitar

Si `seno`, `matriz` o `determinante` te suenan lejanos, leé esto primero.
Con estas cinco ideas alcanza para entender todo el resto del documento.

### 0a. Un punto es solo un par (o trío) de números

`(x, y)` es un punto en un plano: `x` cuánto a la derecha, `y` cuánto para
arriba. `(x, y, z)` es lo mismo pero en 3D, agregando `z` = profundidad
(cuánto adelante/atrás). Todo lo que sigue es simplemente mover, rotar o
aplastar estos pares/tríos de números — no hay nada más "místico" que eso.

### 0b. Seno y coseno: la rueda de la bicicleta

Imaginá un punto que gira alrededor de un círculo de radio 1, como el
reflector de una rueda de bicicleta. Si `θ` es el ángulo que giró desde la
derecha:

```
x = cos(θ)   ← "cuánto a la derecha está el reflector"
y = sin(θ)   ← "cuánto para arriba está el reflector"
```

Eso es todo. `sin` y `cos` son simplemente las coordenadas de un punto que
gira. Cuando el código rota algo por un ángulo `yaw` o `pitch`, en el fondo
está preguntando "¿dónde cae este punto si lo hago girar `θ` grados
alrededor del centro?" — y la respuesta siempre se escribe con senos y
cosenos.

### 0c. Una matriz es una "máquina" que transforma puntos

No es más que una tabla de números que le decimos "multiplicá esto por
cada punto y te da un punto nuevo". Por ejemplo, esta receta:

```
x' = a*x + b*y
y' = c*x + d*y
```

se escribe en forma compacta como matriz:

```
[x']   [a  b] [x]
[y'] = [c  d] [y]
```

Es literalmente la misma cuenta, solo con notación más corta. Una "matriz
de rotación" es una tabla de números *ya armada* con senos y cosenos, de
forma que al multiplicarla por un punto, el resultado es ese mismo punto
pero girado un ángulo `θ`:

```
[cos θ  -sin θ]
[sin θ   cos θ]
```

Por qué esta fórmula exacta rota — no hace falta memorizarlo, alcanza con
confiar en que es la receta estándar (viene de la trigonometría de 0b) y
reconocerla cuando aparezca en el código.

### 0d. Dividir por la profundidad es lo que hace la perspectiva

Pensá en una foto: un auto lejos se ve chiquito, el mismo auto cerca se ve
grande. La regla es "tamaño en la foto = tamaño real / distancia". Por
eso, en todo este documento, cada vez que se ve algo como:

```
pantalla = foco * coordenada / z
```

es exactamente esa idea: `z` es "qué tan lejos", y dividir por un número
grande (lejos) da un resultado chico (se ve chico en pantalla); dividir
por un número chico (cerca) da un resultado grande (se ve grande). Este
único paso —dividir por la profundidad— es *la* diferencia entre dibujar
algo "plano" y darle sensación de 3D.

### 0e. Coordenadas homogéneas: el truco para meter la perspectiva en una matriz

Una matriz común (como la de 0c) solo puede rotar/estirar, no puede
"dividir por z" ni mover puntos (trasladar). El truco de las
**coordenadas homogéneas** es agregar un número extra `w` a cada punto:
en vez de `(x, y)` usamos `(x, y, w)`, y al final siempre se hace:

```
x_real = x / w
y_real = y / w
```

Mientras `w = 1`, no cambia nada. Pero si una matriz 3×3 logra que `w`
termine siendo distinto de 1 (por ejemplo, `w` dependa de `x` o `y` de
entrada), entonces esa división final *es* la perspectiva. Esto es
exactamente lo que hacen las filas `[g h 1]` de una homografía (ver
`§2`): permiten que `w` varíe según el punto, lo cual es lo que deforma un
cuadrado en un trapecio.

### 0f. Determinante: un solo número que resume si una matriz "se puede deshacer"

El **determinante** de una matriz es un número que sale de combinar sus
entradas de una forma específica (hay una fórmula, no hace falta
inventarla). Lo único que importa para este documento:

- Si el determinante es `0`, la matriz "aplasta" el espacio (por ejemplo,
  convierte todo un plano en una sola línea) y **no se puede invertir** —
  no hay forma de volver atrás y recuperar el punto original.
- Si no es `0`, existe una matriz "inversa" que deshace exactamente lo que
  la original hizo. Por eso en `§2b` se calcula un determinante: es el
  paso obligatorio antes de poder invertir la homografía.

Con estas seis ideas (punto, seno/coseno, matriz, división por
profundidad, coordenadas homogéneas, determinante) ya se puede leer el
resto del documento línea por línea sin magia.

---

## 1. Proyección de esquinas — `projectCorners()`

El rectángulo vive sobre un plano de suelo en un mundo 3D falso, centrado
en el origen:

```js
var corners3d = [
  [-hw, 0, -hh],
  [hw, 0, -hh],
  [hw, 0, hh],
  [-hw, 0, hh]
];
```

Cada esquina es `(x, y, z)` con `y = 0` (plana sobre el suelo). `x` es
izquierda/derecha, `z` es adelante/atrás, `y` es arriba/abajo. Cuatro
esquinas, una por vértice del rectángulo.

### 1a. Yaw — rotar sobre el eje vertical

```js
var x = p[0] * cosY - p[2] * sinY;
var z0 = p[0] * sinY + p[2] * cosY;
```

Matriz de rotación 2D estándar, aplicada al plano `(x, z)` (el plano de
suelo, visto desde arriba):

```
[x']   [cosY  -sinY] [x]
[z'] = [sinY   cosY] [z]
```

`yaw` es el ángulo que la cámara orbitó alrededor del rectángulo. Rotar el
*rectángulo* en `-yaw` equivale a rotar la *cámara* en `+yaw` a su
alrededor — mismo resultado visual, más barato de calcular (el rectángulo
tiene 4 puntos, la cámara ninguno). Por esto arrastrar izquierda/derecha
gira el suelo.

**En criollo (ver `§0b`/`§0c`):** esto es ni más ni menos que la matriz de
rotación de la rueda de bicicleta, aplicada al plano `(x, z)` en vez de al
plano `(x, y)`. Si estuvieras parado mirando el suelo desde arriba,
`yaw` es cuántos grados gira todo el dibujo, y `cosY`/`sinY` son las
coordenadas del "reflector" que marca esa rotación.

### 1b. Pitch — inclinar el plano hacia/lejos de la cámara, luego alejarlo

```js
var y2 = y * cosP - z0 * sinP;
var z = y * sinP + z0 * cosP + cam.dist;
```

Misma forma de matriz de rotación, esta vez mezclando la `z0` ya rotada
por yaw con la `y` vertical:

```
[y2]   [cosP  -sinP] [y ]
[z ] = [sinP   cosP] [z0]      luego z += dist
```

Como cada esquina tiene `y = 0` antes de este paso, esta rotación es lo que
realmente produce la perspectiva: es lo que levanta el borde "lejano" del
rectángulo en `y2` (arriba en pantalla) mientras empuja su `z` (profundidad)
más lejos de la cámara. `dist` luego simplemente se suma a `z` — alejando
todo el plano de la cámara. Ese es el control de "zoom" (dolly):

```
scroll → cam.dist *= 1.1 o 0.9  → todo el plano se aleja/acerca
```

**En criollo:** `pitch` es la misma idea de rotación de `§1a`, pero
inclinando el plano "hacia atrás" en vez de girarlo "de costado" — como
reclinar el respaldo de una silla. Y `dist` es simplemente "cuántos metros
más lejos poner todo", así que se suma directo a la profundidad `z`.
Cuanto más lejos, más chico se va a ver todo cuando lleguemos a `§1c`
(recordá `§0d`: dividir por un `z` grande da un resultado chico).

### 1c. Proyección pinhole — punto 3D → píxel 2D de pantalla

```js
var sx = (FOCAL * x) / z + cx;
var sy = (FOCAL * y2) / z + cy;
```

Esta es la ecuación clásica de cámara pinhole:

```
pantalla = distancia_focal * (coord_mundo / profundidad) + centro
```

Dividir por `z` (profundidad) es *el* paso de perspectiva — por eso los
puntos más lejanos (`z` grande) caen más cerca del punto de fuga
`(cx, cy)`, y los puntos más cercanos (`z` chico) se separan más.
`FOCAL = 500` solo controla el campo de visión (más grande = lente más
angosto/con más zoom).

**En criollo:** esta es exactamente la fórmula de la foto de `§0d`
(`tamaño en foto = tamaño real / distancia`), con dos agregados prácticos:
`FOCAL` es un factor de escala general (como el zoom de la lente: agranda
o achica todo por igual) y `+ cx`/`+ cy` simplemente desplaza el resultado
para que el "centro óptico" (`0,0` en la fórmula) caiga en el centro de la
pantalla en vez de en la esquina superior izquierda. Sin ese `+cx, +cy`,
la imagen se vería técnicamente igual de "en perspectiva" pero corrida
fuera de la pantalla.

Salida de toda esta función: 4 pares `(sx, sy)` — simples píxeles 2D de
pantalla. Todo lo que sigue nunca vuelve a tocar 3D.

### Diagrama — rectángulo del mundo → trapecio en pantalla

<svg viewBox="0 0 780 380" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:780px">
  <style>
    .lbl { font: 13px monospace; fill: #333; }
    .lbl2 { font: 12px monospace; fill: #666; }
    .axis { stroke: #999; stroke-width: 1; }
    .rect3d { fill: none; stroke: #2b7de9; stroke-width: 2; }
    .proj { fill: none; stroke: #999; stroke-dasharray: 3 3; stroke-width: 1; }
    .trap { fill: #ffe9b3; stroke: #d99a1b; stroke-width: 2; }
  </style>
  <!-- IZQUIERDA: vista mundo (tipo cenital) -->
  <text x="10" y="20" class="lbl">mundo (plano de suelo, y=0), antes de proyectar</text>
  <line x1="40" y1="150" x2="330" y2="150" class="axis"/>
  <text x="335" y="154" class="lbl2">x</text>
  <line x1="185" y1="230" x2="185" y2="40" class="axis"/>
  <text x="170" y="35" class="lbl2">z (profundidad)</text>
  <!-- esquinas del rectángulo p0..p3 (antes de yaw, alineadas a ejes) -->
  <polygon points="125,110 245,110 245,190 125,190" class="rect3d" stroke-dasharray="4 3"/>
  <text x="100" y="105" class="lbl2">p0(-hw,0,-hh)</text>
  <text x="250" y="105" class="lbl2">p1(hw,0,-hh)</text>
  <text x="250" y="205" class="lbl2">p2(hw,0,hh)</text>
  <text x="95" y="205" class="lbl2">p3(-hw,0,hh)</text>
  <!-- rectángulo ya rotado por yaw -->
  <polygon points="140,90 260,130 220,220 100,180" class="rect3d"/>
  <text x="330" y="90" class="lbl2">↑ mismo rect. tras rotación</text>
  <text x="330" y="106" class="lbl2">  de yaw (§1a)</text>
  <!-- ojo de la cámara -->
  <circle cx="185" cy="330" r="4" fill="#c0392b"/>
  <text x="150" y="348" class="lbl2">ojo de cámara (dist detrás del plano)</text>
  <line x1="185" y1="330" x2="140" y2="90" class="proj"/>
  <line x1="185" y1="330" x2="260" y2="130" class="proj"/>
  <line x1="185" y1="330" x2="220" y2="220" class="proj"/>
  <line x1="185" y1="330" x2="100" y2="180" class="proj"/>
  <!-- flecha al diagrama derecho -->
  <line x1="360" y1="200" x2="410" y2="200" stroke="#333" stroke-width="2" marker-end="url(#arrowes1)"/>
  <text x="358" y="190" class="lbl2">división pinhole por z (§1c)</text>
  <defs>
    <marker id="arrowes1" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
    </marker>
  </defs>
  <!-- DERECHA: trapecio resultante en pantalla -->
  <text x="440" y="20" class="lbl">espacio pantalla (tras sx = FOCAL*x/z + cx)</text>
  <polygon points="470,90 700,100 730,270 450,250" class="trap"/>
  <text x="440" y="85" class="lbl2">s0</text>
  <text x="705" y="95" class="lbl2">s1</text>
  <text x="735" y="270" class="lbl2">s2</text>
  <text x="415" y="255" class="lbl2">s3</text>
  <text x="470" y="300" class="lbl2">borde lejano (s0-s1) más corto — efecto punto de fuga</text>
  <text x="470" y="316" class="lbl2">borde cercano (s3-s2) más largo — más cerca de cámara</text>
</svg>

Las líneas punteadas son las líneas de visión reales desde el ojo de la
cámara pasando por cada esquina del mundo — donde cruzan la "pantalla" (el
paso de dividir por `z`) está `(sx, sy)`. Mismo rectángulo, pero el borde
lejano (`s0-s1`) se comprime hacia el punto de fuga y el borde cercano
(`s3-s2`) queda ancho: ese es el trapecio que la homografía tiene que
rellenar.

---

## 2. Homografía inversa — mapear píxeles de pantalla a UV del tile

Ahora tenemos un cuadrilátero de pantalla (4 esquinas, generalmente un
trapecio, no un rectángulo — esa es la deformación que ve el usuario).
Necesitamos: para el píxel `(px, py)` dentro de ese cuadrilátero, ¿a qué
`(u, v) ∈ [0,1]×[0,1]` del *tile origen* corresponde?

Una **homografía** es la transformación proyectiva 3×3 general:

```
[x]   [a  b  c] [u]
[y] = [d  e  f] [v]
[w]   [g  h  1] [1]

pantalla_x = x / w,  pantalla_y = y / w
```

Cuando `g = h = 0` esto degrada a un mapeo afín (paralelogramo). `g, h`
distintos de cero son exactamente lo que permite que un *cuadrado* mapee a
un *trapecio* — necesario aquí, dado que el suelo proyectado es un
trapecio, no un paralelogramo, cada vez que la cámara mira con ángulo.

**En criollo (ver `§0e`):** esa fila `[g h 1]` de abajo es justo el truco
de las coordenadas homogéneas. `w = g*u + h*v + 1` — si `g` y `h` son
cero, `w` siempre vale `1` y no pasa nada especial (es un mapeo "recto",
sin perspectiva: un cuadrado da un paralelogramo). Pero si `g` o `h` no
son cero, `w` cambia según en qué parte del cuadrado estés parado (`u,v`),
y como al final se divide por `w`, distintas partes del cuadrado se
"achican" o "agrandan" de manera distinta — eso es lo que convierte un
cuadrado prolijo en un trapecio con un lado más angosto que el otro. Es la
misma idea de dividir-por-profundidad de `§0d`/`§1c`, solo que ahora la
"profundidad" (`w`) no viene de un mundo 3D sino que se fabrica a
propósito con `g, h` para lograr el efecto correcto en 2D.

### Diagrama — cuadrado unitario ↔ trapecio en pantalla

<svg viewBox="0 0 780 300" xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:780px">
  <style>
    .lbl { font: 13px monospace; fill: #333; }
    .lbl2 { font: 12px monospace; fill: #666; }
    .grid { stroke: #bcd; stroke-width: 1; }
    .sq { fill: #eef4ff; stroke: #2b7de9; stroke-width: 2; }
    .trap2 { fill: #ffe9b3; stroke: #d99a1b; stroke-width: 2; }
  </style>
  <!-- IZQUIERDA: cuadrado unitario origen (u,v) con grilla del tile -->
  <text x="40" y="20" class="lbl">tile origen, (u,v) en [0,1]x[0,1]</text>
  <rect x="60" y="40" width="200" height="200" class="sq"/>
  <!-- líneas de grilla para sugerir el tiling -->
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
  <!-- flechas en ambas direcciones -->
  <line x1="290" y1="110" x2="380" y2="110" stroke="#333" stroke-width="2" marker-end="url(#arrowes2)"/>
  <text x="292" y="100" class="lbl2">H  (se construye, §2a)</text>
  <line x1="380" y1="170" x2="290" y2="170" stroke="#333" stroke-width="2" marker-end="url(#arrowes2)"/>
  <text x="292" y="190" class="lbl2">Hinv  (se usa por píxel, §2c)</text>
  <defs>
    <marker id="arrowes2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
    </marker>
  </defs>
  <!-- DERECHA: trapecio destino (pantalla), misma correspondencia de esquinas -->
  <text x="440" y="20" class="lbl">destino: trapecio de pantalla dst[0..3]</text>
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

`H` se *construye una vez por frame* a partir de las 4 correspondencias de
esquinas (`§2a`). `Hinv` se evalúa luego *una vez por píxel* dentro del
loop de render (`§2c`) — misma matriz, dirección opuesta: dado un píxel de
pantalla, qué `(u,v)` lo iluminó.

### 2a. Resolviendo la homografía — `computeHomography(dst)`

Queremos `H` tal que el cuadrado unitario `(0,0) (1,0) (1,1) (0,1)` mapee a
las 4 esquinas de pantalla `dst[0..3]`. El código usa la solución cerrada
(square-to-quad de Heckbert):

```js
var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
```

`dx3, dy3` miden cuánto se desvía el cuadrilátero de ser un paralelogramo
(si `dst` fuera un paralelogramo real, `x0 - x1 + x2 - x3 = 0`). Esa
desviación es exactamente lo que se resuelve para `g, h`:

```js
var den = dx1 * dy2 - dx2 * dy1;
g = (dx3 * dy2 - dx2 * dy3) / den;
h = (dx1 * dy3 - dx3 * dy1) / den;
```

(`den` es un determinante 2×2 — regla de Cramer para el sistema de 2
ecuaciones y 2 incógnitas `dx3 = g*dx1 + h*dx2`, `dy3 = g*dy1 + h*dy2`.)

Una vez que `g, h` se conocen, `a..f` se obtienen directamente igualando
las otras 3 esquinas:

```js
var a = x1 - x0 + g * x1;
var b = x3 - x0 + h * x3;
var c = x0;
var d = y1 - y0 + g * y1;
var e = y3 - y0 + h * y3;
var f = y0;
```

(`c = x0, f = y0` porque al reemplazar `u=v=0` en la homografía debe dar
directamente la esquina 0.)

**En criollo:** no hace falta seguir cada paso algebraico a mano. La idea
completa de `§2a` es: "tengo 4 puntos de entrada (las esquinas del
cuadrado `0,0 / 1,0 / 1,1 / 0,1`, que son siempre las mismas) y 4 puntos de
salida (`dst[0..3]`, las esquinas de pantalla que salieron de `§1`).
Quiero *la* matriz que mande cada entrada exactamente a su salida
correspondiente." Como son 4 puntos con `x` e `y` cada uno, son 8
ecuaciones, y la homografía tiene 8 números libres (`a` hasta `h`, con `i`
fijado en `1`) — por eso siempre hay *una* solución, ni más suelta ni más
ajustada. El código de arriba es simplemente resolver esas 8 ecuaciones a
mano, ya simplificadas en fórmulas directas para no tener que invertir una
matriz enorme en cada frame.

### 2b. Invirtiéndola — `invertHomography(H)`

`H` mapea `uv → pantalla`. Necesitamos la dirección opuesta para rellenar
píxeles, así que invertimos la matriz 3×3 usando el método
adjunta/cofactores:

```js
var A = e * i - f * h;   // cofactores ...
...
var det = a * A + b * B + c * C;   // = determinante, vía expansión por cofactores
var inv = 1 / det;
return [A*inv, D*inv, G*inv, ...];  // adjunta^T / det
```

Esto es la fórmula clásica `inversa = adjunta(M) / det(M)` para una matriz
3×3 — sin atajos, la fórmula general, ya que una homografía no está
garantizada ortogonal ni tiene ninguna propiedad especial que permita
saltárselo.

**En criollo (ver `§0f`):** invertir una matriz es preguntarse "si tengo el
resultado, ¿cómo hago para volver al punto original?". `H` convierte
`(u,v) → pantalla`; para el render necesitamos lo opuesto,
`pantalla → (u,v)`, así que hay que invertir `H`. El `det` (determinante)
es el número que primero hay que calcular para saber "sí, se puede volver
atrás" (si fuera `0`, `H` habría aplastado el cuadrado en una línea y no
habría manera de recuperar `u,v` a partir de un píxel). Una vez que se
sabe que se puede, la fórmula de la adjunta es solo la receta mecánica
para calcular cada número de la matriz inversa — no hay ningún truco
oculto, es la misma fórmula que se usaría a mano en una hoja de papel.

### 2c. Muestreo por píxel — el loop de render

```js
var w = g * px + h * py + iH;
var u = (a * px + b * py + c) / w;
var v = (d * px + e * py + f) / w;
```

Esto es `Hinv` aplicada al punto homogéneo de pantalla `(px, py, 1)`, luego
deshomogeneizado (dividiendo por `w`) — la misma división estilo pinhole
que el paso 1c, solo que ahora yendo de pantalla → textura en vez de
mundo → pantalla. Esta división es lo que hace el muestreo
*perspectiva-correcto*: sin ella (es decir, interpolación afín naive de
`u,v` a lo largo del cuadrilátero) los tiles se verían visiblemente
curvados/deformados en vez de alejarse en líneas rectas — el clásico
artefacto de "texture warp" de la era PS1 que este código evita.

```js
if (u < 0 || u > 1 || v < 0 || v > 1) continue;
```

Fuera del cuadrado unitario = fuera del rectángulo = se descarta
(transparente/negro).

### 2d. Tiling ("en loop")

```js
var tx = ((u * REPEAT * tileW) | 0) % tileW;
var ty = ((v * REPEAT * tileH) | 0) % tileH;
```

`u ∈ [0,1]` se escala por `REPEAT` (copias a lo largo del rectángulo) y por
`tileW` (píxeles por copia), luego se envuelve con `% tileW`. Esto es lo
que hace que la imagen de un solo tile se repita sin costuras por todo el
rectángulo en vez de estirarse una sola vez — el requisito de "en loop".

---

## Resumen de la cadena causal

```
arrastre mouse → cam.yaw, cam.pitch  (§1a, §1b — matrices de rotación)
rueda mouse     → cam.dist           (§1b — se suma a la profundidad)
              ↓
projectCorners()                     (§1c — división pinhole, solo 4 puntos)
              ↓
4 esquinas de pantalla (un trapecio)
              ↓
computeHomography() → invertHomography()   (§2a, §2b — álgebra proyectiva)
              ↓
por píxel: pantalla(px,py) → Hinv → (u,v)  (§2c — división perspectiva-correcta)
              ↓
(u,v) → envolver por REPEAT/tileW,tileH → píxel del tile   (§2d — el loop)
```

Todo lo que sigue a `projectCorners()` es álgebra lineal/proyectiva 2D
sobre una grilla de píxeles plana — sin z-buffer, sin rasterizador 3D, sin
matrices más grandes que 3×3. La sensación "3D" es enteramente subproducto
de los pasos 1b/1c (división perspectiva) que dan forma de trapecio a 4
puntos, y del paso 2c que reproduce ese mismo tipo de división por píxel
para que la textura interior se deforme de manera consistente con eso.

---

## Referencias

- [3D Math Primer for Graphics and Game Development](https://gamemath.com/book/) —
  Fletcher Dunn & Ian Parberry. Texto completo gratuito (en inglés). Cubre
  vectores, matrices, coordenadas homogéneas y proyección perspectiva con
  mucha más profundidad que `§0` acá — buen siguiente paso si querés el
  panorama completo detrás de `§1`/`§2`. Los capítulos 1, 4, 7 y 10 son los
  que más se relacionan con este documento.
