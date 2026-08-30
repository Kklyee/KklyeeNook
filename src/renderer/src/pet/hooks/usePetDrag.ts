import { useRef } from 'react';

const DRAG_THRESHOLD = 5;

type Options = { onClick?: () => void; onDragStart?: () => void; onDragEnd?: () => void };

export function usePetDrag({ onClick, onDragStart, onDragEnd }: Options = {}) {
  const dragRef = useRef({
    active: false,
    dragging: false,
    startPointerX: 0,
    startPointerY: 0,
    startWindowX: 0,
    startWindowY: 0,
  });

  const onPointerDown = async (event: React.PointerEvent<HTMLElement>) => {
    // 只处理鼠标左键
    if (event.button !== 0) return;

    const [windowX, windowY] = await window.api.getWindowPosition();

    dragRef.current = {
      active: true,
      dragging: false,

      startPointerX: event.screenX,
      startPointerY: event.screenY,

      startWindowX: windowX,
      startWindowY: windowY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag.active) return;

    const deltaX = event.screenX - drag.startPointerX;

    const deltaY = event.screenY - drag.startPointerY;

    // 鼠标稍微抖动不算拖动
    if (!drag.dragging && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      drag.dragging = true;
      onDragStart?.();
    }

    if (!drag.dragging) return;

    window.api.setWindowPosition(drag.startWindowX + deltaX, drag.startWindowY + deltaY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag.active) return;

    const wasDragging = drag.dragging;

    drag.active = false;
    drag.dragging = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (wasDragging) {
      onDragEnd?.();
      return;
    }

    onClick?.();
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    dragRef.current.active = false;
    dragRef.current.dragging = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
