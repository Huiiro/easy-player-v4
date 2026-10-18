# Black hole background

The built-in `blackhole` theme uses a Schwarzschild (non-spinning) spacetime with a
procedural, partially transparent thin disk. The observer stays at `18 Rs` and
looks at the origin. Mouse movement changes azimuth and elevation, keeping the
shadow at the center of the canvas. This is a real-time visualization, not a full
Kerr / relativistic magnetohydrodynamics simulation.

## Light transport

- Units: event horizon `Rs = 1`, photon sphere `r = 1.5`, disk inner edge / ISCO
  `r = 3`. The disk fades out at `r = 11.5`.
- `blackHoleGeodesics.ts` integrates `u'' = 1.5 u² - u`, with `u = 1/r`, using RK4.
  Initial conditions use the impact parameter measured in the observer's local
  frame. Rays end at the horizon or escape to infinity.
- Spherical symmetry lets all pixels share one radial trajectory table. Sampling
  clusters around the critical impact parameter `sqrt(27)/2`, with separate
  interpolation domains for captured and escaped rays.
- Intersections with the equatorial plane are spaced by pi in orbital angle.
  The shader composites up to four crossings in observer order. Higher-order
  disk images and the thin photon ring come from these paths, without a painted
  ring or radial screen-space distortion.
- The escape direction samples procedural directional stars, galactic emission,
  and dust lanes. Captured rays get no background light.
- Emission uses local circular orbital velocity, gravitational lapse, and the
  observer lapse to compute a frequency shift `g`. Bolometric intensity is scaled
  by `g^4`; a three-wavelength Planck approximation colors the shifted temperature.
  Exposure, opacity, density noise and the visible temperature scale are artistic
  choices. The model omits light-travel-time differences between disk images.
- Turbulence is periodic in azimuth and advected with radius-dependent Keplerian
  speed, keeping the angle seam continuous.

References:

- [Schwarzschild null geodesics and higher-order images](https://www.nature.com/articles/s41598-021-93595-w)
- [Bolometric transport and disk-crossing sum, equation 48](https://www.aanda.org/articles/aa/pdf/2022/12/aa44216-22.pdf)

## Runtime limits

The trajectory worker generates a `1024 × 384` RG32F table (3 MiB) once per mount
and transfers its buffers. The fragment shader performs texture lookups instead
of numerical integration per pixel. It takes two extra samples only around the
critical annulus to reduce aliasing of narrow rings.

Rendering targets 30 FPS. The initial pixel budget is 650,000, bounded between
200,000 and 1,000,000, with a 1600-pixel maximum dimension and 1.5 DPR cap. When
available, asynchronous GPU timing queries adjust this budget every four seconds;
otherwise sustained slow animation frames lower it. No `finish` or `readPixels`
is used in the render loop. Actual frame rate depends on hardware and load.

Window blur, document hiding, the player overlay and reduced-motion preference
pause rendering. Pointer handlers only record targets; smoothing occurs in the
render loop. The overlay stays non-interactive so player controls receive clicks.
Context loss shows the CSS fallback and restoration reuploads retained tables.
Unmount terminates the worker, removes listeners, cancels frames and releases GPU
resources. WebGL2 failure keeps the static fallback.

## Verification

Run `node scripts/check-black-hole.mjs` to check photon-sphere equilibrium,
capture/escape classification, conserved orbital energy, winding trajectories,
and LUT disk radii against fine-step integration. Run ESLint on the four theme
files and `npm run build:nocheck` to validate the Vue/worker production bundle.
