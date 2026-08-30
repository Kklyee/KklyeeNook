import { app, shell, BrowserWindow } from 'electron';
import { PetRuntime } from './pet/petRuntime';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { sendPetState } from './ipc/petIpc';
import { registerAgentIpc } from './ipc/agentIpc';
import { createPetWindow } from './window/petWindow';

function createWindow(): void {
  // Create the browser window.
  const mainWindow = createPetWindow();

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    const petRuntime = new PetRuntime((state) => {
      sendPetState(mainWindow, state);
    });

    setTimeout(() => {
      petRuntime.dispatch({ type: 'agent_started' });
    }, 2000);

    setTimeout(() => {
      petRuntime.dispatch({ type: 'tool_started', tool: 'read' });
    }, 5000);

    setTimeout(() => {
      petRuntime.dispatch({ type: 'approval_required', message: '允许执行命令吗？' });
    }, 8000);
    setTimeout(() => {
      petRuntime.dispatch({ type: 'agent_completed' });
    }, 11000);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test

  createWindow();
  registerAgentIpc();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
