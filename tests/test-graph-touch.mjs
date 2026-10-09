import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
function load(file, imports = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require: name => imports[name] });
  return module.exports;
}
const camera = load('lib/graph-camera.ts');
const { touchPair, pinchCamera } = load('lib/graph-touch.ts', { './graph-camera': camera });
const initial = { x: 12, y: -40, zoom: 0.6 };
const start = touchPair([{ x: 80, y: 180 }, { x: 240, y: 180 }]);
for (const points of [
  [{ x: 20, y: 220 }, { x: 340, y: 220 }],
  [{ x: 120, y: 250 }, { x: 200, y: 250 }],
  [{ x: -10000, y: 200 }, { x: 10000, y: 200 }],
  [{ x: 160, y: 180 }, { x: 160, y: 180 }],
]) {
  const next = touchPair(points), result = pinchCamera(initial, start, next);
  assert.ok(result.zoom >= camera.MIN_GRAPH_ZOOM && result.zoom <= camera.MAX_GRAPH_ZOOM);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
  assert.ok(Math.abs((start.center.x - initial.x) / initial.zoom - (next.center.x - result.x) / result.zoom) < 1e-8, 'fingers keep hold of the same graph position horizontally');
  assert.ok(Math.abs((start.center.y - initial.y) / initial.zoom - (next.center.y - result.y) / result.zoom) < 1e-8, 'fingers keep hold of the same graph position vertically');
}
assert.equal(initial.zoom, 0.6, 'camera input remains unchanged');
console.log('Mobile pinch, simultaneous pan, zoom limits and coincident fingers passed');
