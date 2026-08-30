import { BrowserWindow } from 'electron';
import path from 'path';
const preloadPath = path.join(__dirname, '../preload/index.js');

console.log('preloadPath', preloadPath);
export function createPetWindow(): BrowserWindow {
  const petWindow = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
  });
  return petWindow;
}
