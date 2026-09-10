import 'dotenv/config'
import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { AppContext, bootstrap } from './app/bootstrap'

let appContext: AppContext | null = null
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    appContext = await bootstrap()
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

app.on('before-quit', () => {
  appContext?.dispose()
  appContext = null
})
