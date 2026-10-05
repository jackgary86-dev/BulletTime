import type { CameraMode } from '../scene/cameraDirector';
import type { LightingMode } from '../scene/studio';

/**
 * Small line icons for the camera and lighting buttons (#76), drawn on a
 * 16-unit grid in the button's text colour.
 */
const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const CAMERA_ICONS: Record<CameraMode, string> = {
  // A clapper-style A: the camera picks the shot.
  auto: svg('<path d="M3 13 8 3l5 10"/><path d="M5 9.5h6"/>'),
  // A side-on view: a bullet heading for a block.
  side: svg('<path d="M1.5 8h5"/><path d="M6.5 6.5 8.5 8l-2 1.5z" fill="currentColor"/><rect x="10.5" y="3.5" width="4" height="9" rx="0.5"/>'),
  // Following: a crosshair with motion lines behind it.
  tracking: svg('<circle cx="10" cy="8" r="3.5"/><path d="M10 3v2M10 11v2M13 8h2"/><path d="M1.5 6h3M1 8h3.5M1.5 10h3"/>'),
  // A magnifier: close in on the impact.
  closeup: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/><path d="M5 7h4M7 5v4"/>'),
  // Free orbit: an arrow round a point.
  orbit: svg('<path d="M13.5 8A5.5 5.5 0 1 1 11 3.4"/><path d="M11.5 1.5 11 3.4 13 4"/><circle cx="8" cy="8" r="1" fill="currentColor"/>'),
  // Inside a room, looking at a hole in the wall (#249).
  inside: svg('<path d="M2 13V3h12v10z"/><circle cx="8" cy="8" r="1.8"/>'),
};

export const LIGHTING_ICONS: Record<LightingMode, string> = {
  // A softbox throwing light.
  lab: svg('<rect x="2" y="2.5" width="7" height="6" rx="1"/><path d="M5.5 8.5v5M3.5 13.5h4"/><path d="M11 4l3-1M11 6h3.5M11 8l3 1"/>'),
  // A lightning strobe.
  highspeed: svg('<path d="M9.5 1.5 4 9h4l-1.5 5.5L12 7H8z"/>'),
};
