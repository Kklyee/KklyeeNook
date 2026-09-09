import 'dotenv/config'
import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { bootstrap } from './app/bootstrap'

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {})

  try {
    await bootstrap()
  } catch (error) {
    console.error('[bootstrap] failed:', error)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
