import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => document.documentElement.classList.toggle('dark', event.matches))
createRoot(document.getElementById('root')!).render(<App />)
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(console.error)
