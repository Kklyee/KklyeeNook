import type { ComponentType } from 'react'
import {
  BookIcon,
  HouseIcon,
  ListChecksIcon,
  MessageCircleIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react'

export type AppView = 'home' | 'chat' | 'tasks' | 'memories' | 'grove' | 'settings'

export type AppNavigationItem = {
  id: AppView
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}

export const primaryNavigation: AppNavigationItem[] = [
  { id: 'home', label: 'Home', icon: HouseIcon },
  { id: 'chat', label: 'Chat', icon: MessageCircleIcon },
  { id: 'tasks', label: 'Tasks', icon: ListChecksIcon },
  { id: 'memories', label: 'Memories', icon: BookIcon },
  { id: 'grove', label: 'Grove', icon: UsersIcon },
]

export const settingsNavigationItem: AppNavigationItem = {
  id: 'settings',
  label: 'Settings',
  icon: SettingsIcon,
}
