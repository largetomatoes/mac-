import { zoomAt, type GraphCamera, type Point } from './graph-camera';

export function touchPair(points: Point[]) {
  const [a, b] = points;
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

/** Keep the same graph position under moving fingers, including at zoom limits. */
export function pinchCamera(camera: GraphCamera, start: ReturnType<typeof touchPair>, next: ReturnType<typeof touchPair>): GraphCamera {
  const zoomed = zoomAt(camera, camera.zoom * next.distance / start.distance, start.center);
  return { ...zoomed, x: zoomed.x + next.center.x - start.center.x, y: zoomed.y + next.center.y - start.center.y };
}
