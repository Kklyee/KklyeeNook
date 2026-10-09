import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => document.documentElement.classList.toggle('dark', event.matches))
const viewport = window.visualViewport
const updateViewport = () => {
  document.documentElement.style.setProperty('--viewport-height', `${viewport?.height ?? window.innerHeight}px`)
  document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`)
}
updateViewport()
viewport?.addEventListener('resize', updateViewport)
viewport?.addEventListener('scroll', updateViewport)
window.addEventListener('resize', updateViewport)
createRoot(document.getElementById('root')!).render(<App />)
if (import.meta.env.PROD && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(console.error)
