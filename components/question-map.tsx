'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Notebook, ROOT, numberOf, crossNumber, crossSignature } from '@/lib/notebook';
import { projectGraph } from '@/lib/graph-projection';
import { GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, layoutGraph, type GraphPosition } from '@/lib/graph-layout';
import { fitGraph, wheelCamera, zoomAt, type GraphCamera } from '@/lib/graph-camera';
import { pinchCamera, touchPair } from '@/lib/graph-touch';

const initialCamera: GraphCamera = { x: 40, y: 100, zoom: 1 };

function boundary(from: GraphPosition, to: GraphPosition) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const amount = 1 / Math.max(Math.abs(dx) / (GRAPH_NODE_WIDTH / 2), Math.abs(dy) / (GRAPH_NODE_HEIGHT / 2), 1);
  return { x: from.x + GRAPH_NODE_WIDTH / 2 + dx * amount, y: from.y + GRAPH_NODE_HEIGHT / 2 + dy * amount };
}

export const QuestionMap = memo(function QuestionMap({ data, loading, onOpen, onAddRoot, mobile = false }: { data: Notebook; loading: boolean; onOpen: (id: string) => void; onAddRoot?: () => void; mobile?: boolean }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const cameraRef = useRef(initialCamera);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; camera: GraphCamera } | null>(null);
  const [camera, setCamera] = useState(initialCamera);
  const [viewport, setViewport] = useState({ width: 900, height: 650 });
  const [dragging, setDragging] = useState(false);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ camera: GraphCamera; pair: ReturnType<typeof touchPair> } | null>(null);
  const tap = useRef<{ id: string | null; x: number; y: number; moved: boolean } | null>(null);
  const ignoreClickUntil = useRef(0);
  const { notes, cards, crossThoughts, links } = data;
  const structure = useMemo(() => ({ notes, cards, crossThoughts, links }), [notes, cards, crossThoughts, links]);
  const projection = useMemo(() => projectGraph(structure), [structure]);
  const positions = useMemo(() => layoutGraph(structure, projection), [structure, projection]);
  const items = useMemo(() => {
    const visible = new Set(projection.visibleIds);
    return [
      ...data.notes.map(note => ({ id: note.id, text: note.title, kind: note.kind, label: note.id === ROOT ? '核心问题' : note.kind === 'question' ? numberOf(note, data.notes, data.crossThoughts) : '回答' })),
      ...data.crossThoughts.map(cross => ({ id: cross.id, text: cross.title || cross.text || '交叉思考', kind: 'cross', label: `${crossNumber(cross)}〔${crossSignature(cross, data)}〕` })),
      ...data.cards.map(card => ({ id: card.id, text: card.text, kind: 'card', label: '卡片' })),
    ].filter(item => visible.has(item.id));
  }, [data, projection]);
  const bounds = useMemo(() => {
    const values = Object.values(positions);
    return { left: Math.min(0, ...values.map(p => p.x)), top: Math.min(0, ...values.map(p => p.y)), right: Math.max(GRAPH_NODE_WIDTH, ...values.map(p => p.x + GRAPH_NODE_WIDTH)), bottom: Math.max(GRAPH_NODE_HEIGHT, ...values.map(p => p.y + GRAPH_NODE_HEIGHT)) };
  }, [positions]);

  // Coalesce only active gestures. There is no idle animation or layout loop.
  const moveCamera = useCallback((next: GraphCamera) => {
    cameraRef.current = next;
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCamera(cameraRef.current);
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (mobile) initialized.current = false;
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      moveCamera(wheelCamera(cameraRef.current, { x: event.deltaX * unit, y: event.deltaY * unit }, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.ctrlKey));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [moveCamera, mobile]);

  useEffect(() => {
    if (initialized.current || loading || !positions[ROOT] || viewport.height <= 0) return;
    initialized.current = true;
    const root = positions[ROOT];
    const rect = canvasRef.current?.getBoundingClientRect();
    moveCamera(mobile ? fitGraph(bounds, rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : viewport) : { x: 40 - root.x, y: viewport.height / 2 - root.y - GRAPH_NODE_HEIGHT / 2, zoom: 1 });
  }, [loading, positions, viewport, moveCamera, mobile, bounds]);

  const resize = (zoom: number) => moveCamera(zoomAt(cameraRef.current, zoom, { x: viewport.width / 2, y: viewport.height / 2 }));
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  const endTouch = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    touches.current.delete(event.pointerId);
    ignoreClickUntil.current = Date.now() + 500;
    if (!cancelled && !tap.current?.moved && tap.current?.id) onOpen(tap.current.id);
    tap.current = null;
    pinch.current = null;
    const remaining = [...touches.current.entries()][0];
    if (remaining) { const rect = event.currentTarget.getBoundingClientRect(); dragRef.current = { pointerId: remaining[0], x: remaining[1].x + rect.left, y: remaining[1].y + rect.top, camera: cameraRef.current }; }
    else endDrag();
  };
  return <div className={'map-canvas' + (dragging ? ' is-dragging' : '') + (mobile ? ' mobile-map-canvas' : '')} ref={canvasRef} tabIndex={0} aria-label={mobile ? '全部问题关系图，单指移动、双指缩放，点击问题查看内容' : '问题关系图，可用触控板滚动或拖动平移'}
    onPointerDown={event => {
      if (mobile && event.pointerType === 'touch') {
        if ((event.target as Element).closest('button')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        touches.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        event.currentTarget.setPointerCapture(event.pointerId);
        if (touches.current.size === 1) {
          const id = (event.target as Element).closest('[data-node]')?.getAttribute('data-node') || null;
          tap.current = { id, x: event.clientX, y: event.clientY, moved: false };
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current };
        } else {
          if (tap.current) tap.current.moved = true;
          pinch.current = { camera: cameraRef.current, pair: touchPair([...touches.current.values()]) };
          dragRef.current = null;
        }
        setDragging(true);
        return;
      }
      if (event.button !== 0 || (event.target as Element).closest('[data-node],button')) return;
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={event => {
      if (mobile && touches.current.has(event.pointerId)) {
        const rect = event.currentTarget.getBoundingClientRect();
        touches.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        if (tap.current && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > 8) tap.current.moved = true;
        if (pinch.current && touches.current.size > 1) {
          moveCamera(pinchCamera(pinch.current.camera, pinch.current.pair, touchPair([...touches.current.values()])));
          return;
        }
      }
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      moveCamera({ ...drag.camera, x: drag.camera.x + event.clientX - drag.x, y: drag.camera.y + event.clientY - drag.y });
    }}
    onPointerUp={event => mobile && touches.current.has(event.pointerId) ? endTouch(event) : endDrag()}
    onPointerCancel={event => mobile && touches.current.has(event.pointerId) ? endTouch(event, true) : endDrag()}
    onLostPointerCapture={event => { if (touches.current.has(event.pointerId)) endTouch(event, true); else if (!touches.current.size) endDrag(); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      const offsets: Record<string, [number, number]> = { ArrowUp: [0, 80], ArrowDown: [0, -80], ArrowLeft: [80, 0], ArrowRight: [-80, 0] };
      const offset = offsets[event.key];
      if (offset) { event.preventDefault(); moveCamera({ ...cameraRef.current, x: cameraRef.current.x + offset[0], y: cameraRef.current.y + offset[1] }); }
    }}>
    {onAddRoot && <Button type="button" variant="outline" size="sm" className="map-add-root" disabled={loading} onClick={onAddRoot}><Plus/>添加一级问题</Button>}
    <svg className="graph-svg" width="100%" height="100%" viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label="全部问题与联系">
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {projection.edges.map(edge => {
          const a = positions[edge.from], b = positions[edge.to];
          if (!a || !b || edge.from === edge.to) return null;
          let path: string;
          if (edge.kind === 'hierarchy') {
            const ax = a.x + GRAPH_NODE_WIDTH, bx = b.x, ay = a.y + GRAPH_NODE_HEIGHT / 2, by = b.y + GRAPH_NODE_HEIGHT / 2;
            const mid = (ax + bx) / 2;
            path = `M${ax} ${ay} C${mid} ${ay},${mid} ${by},${bx} ${by}`;
          } else {
            const start = boundary(a, b), end = boundary(b, a);
            path = `M${start.x} ${start.y} L${end.x} ${end.y}`;
          }
          return <path key={edge.id} d={path} className={`edge ${edge.kind}`} fill="none" pointerEvents="none"><title>{edge.type}</title></path>;
        })}
        {items.map(item => {
          const position = positions[item.id];
          if (!position) return null;
          return <g key={item.id} data-node={item.id} role="button" tabIndex={0} aria-label={`${item.label}：${item.text}`}
            className={`map-node ${item.kind}${item.id === ROOT ? ' root-node' : ''}`} transform={`translate(${position.x} ${position.y})`}
            onClick={() => { if (Date.now() > ignoreClickUntil.current) onOpen(item.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(item.id); } }}>
            <title>{item.label} · {item.text}</title>
            <rect className="node-surface" width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} rx="10" />
            <foreignObject x="18" y="12" width={GRAPH_NODE_WIDTH - 36} height="23"><div className="node-tag">{item.label}</div></foreignObject>
            <foreignObject x="18" y="40" width={GRAPH_NODE_WIDTH - 36} height="75"><div className="node-words">{item.text}</div></foreignObject>
          </g>;
        })}
      </g>
    </svg>
    {loading && <div className="map-loading"><Loader2 className="spin" />读取中</div>}
    <div className="map-controls">
      <Button variant="ghost" size="icon" aria-label="缩小关系图" title="缩小" onClick={() => resize(cameraRef.current.zoom / 1.2)}><Minus /></Button>
      <button type="button" className="map-zoom-value" aria-label="恢复百分之百大小" title="恢复 100%" onClick={() => resize(1)}>{Math.round(camera.zoom * 100)}%</button>
      <Button variant="ghost" size="icon" aria-label="放大关系图" title="放大" onClick={() => resize(cameraRef.current.zoom * 1.2)}><Plus /></Button>
      <Button variant="ghost" size="icon" aria-label="查看全图" title="查看全图" onClick={() => moveCamera(fitGraph(bounds, viewport))}><Maximize /></Button>
      {mobile && <button type="button" onClick={() => { const root = positions[ROOT]; if (root) moveCamera({ zoom: 1, x: viewport.width / 2 - root.x - GRAPH_NODE_WIDTH / 2, y: viewport.height / 2 - root.y - GRAPH_NODE_HEIGHT / 2 }); }}>核心</button>}
    </div>
  </div>;
});
