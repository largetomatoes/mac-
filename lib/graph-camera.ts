export type Point = { x: number; y: number };
export type GraphCamera = Point & { zoom: number };
export type GraphBounds = { left: number; top: number; right: number; bottom: number };
export const MIN_GRAPH_ZOOM = 0.02;
export const MAX_GRAPH_ZOOM = 2.5;

/** Keep the graph point under the pointer fixed while changing scale. */
export function zoomAt(camera: GraphCamera, zoom: number, point: Point): GraphCamera {
  const next = Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, zoom));
  const ratio = next / camera.zoom;
  return { zoom: next, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio };
}

export function wheelCamera(camera: GraphCamera, delta: Point, point: Point, pinch: boolean): GraphCamera {
  return pinch
    ? zoomAt(camera, camera.zoom * Math.exp(-delta.y * 0.01), point)
    : { ...camera, x: camera.x - delta.x, y: camera.y - delta.y };
}

export function fitGraph(bounds: GraphBounds, viewport: { width: number; height: number }): GraphCamera {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const zoom = Math.min(1, Math.max(MIN_GRAPH_ZOOM, Math.min(Math.max(1, viewport.width - 96) / width, Math.max(1, viewport.height - 96) / height)));
  return { zoom, x: (viewport.width - width * zoom) / 2 - bounds.left * zoom, y: (viewport.height - height * zoom) / 2 - bounds.top * zoom };
}
