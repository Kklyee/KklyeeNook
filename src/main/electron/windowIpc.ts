import { IPC_CHANNELS } from '@/shared/ipc/channels';
import { ipcMain, BrowserWindow } from 'electron';

const dragWindowSizes = new WeakMap<BrowserWindow, { width: number; height: number }>();

export function registerWindowIpc() {
  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_POSITION, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return [0, 0] as [number, number];
    }

    const { x, y, width, height } = window.getBounds();
    dragWindowSizes.set(window, { width, height });
    return [x, y] as [number, number];
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_SET_POSITION, (event, x: number, y: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) return;

    const before = window.getBounds();
    const targetX = Math.round(x);
    const targetY = Math.round(y);
    const size = dragWindowSizes.get(window) ?? before;

    if (
      before.x === targetX &&
      before.y === targetY &&
      before.width === size.width &&
      before.height === size.height
    ) {
      return;
    }

    window.setBounds({ x: targetX, y: targetY, width: size.width, height: size.height }, false);
  });
}
