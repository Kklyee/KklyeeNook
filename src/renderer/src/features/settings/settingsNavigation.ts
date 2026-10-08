import type { ComponentType } from 'react'
import {
  BotIcon,
  GlobeIcon,
  ImageIcon,
  PuzzleIcon,
  SmartphoneIcon,
  ShieldCheckIcon,
  TextSearchIcon,
} from 'lucide-react'

export type SettingsTab =
  | 'remote'
  | 'appearance'
  | 'model'
  | 'web-search'
  | 'context'
  | 'permissions'
  | 'plugins'
export type SettingsLayout = 'preferences' | 'manager'

export type SettingsNavigationItem = {
  id: SettingsTab
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  layout: SettingsLayout
}

export const settingsNavigation: SettingsNavigationItem[] = [
  {
    id: 'remote',
    label: 'Remote',
    description: '通过 Tailscale 在手机上使用 Desktop Agent。',
    icon: SmartphoneIcon,
    layout: 'preferences',
  },
  {
    id: 'appearance',
    label: '外观',
    description: '更换应用壁纸，设置窗口的毛玻璃质感。',
    icon: ImageIcon,
    layout: 'preferences',
  },
  {
    id: 'model',
    label: '模型',
    description: '配置模型提供商和可用模型。',
    icon: BotIcon,
    layout: 'manager',
  },
  {
    id: 'web-search',
    label: 'Web Search',
    description: '让 Agent 搜索最新的网络信息。',
    icon: GlobeIcon,
    layout: 'preferences',
  },
  {
    id: 'context',
    label: '上下文',
    description: '配置自动压缩和高级参数。',
    icon: TextSearchIcon,
    layout: 'preferences',
  },
  {
    id: 'permissions',
    label: '权限与安全',
    description: '设置默认权限并管理临时授权。',
    icon: ShieldCheckIcon,
    layout: 'preferences',
  },
  {
    id: 'plugins',
    label: '插件',
    description: '统一管理 Skills、Memory、MCP 和 Knowledge，扩展 Agent 的能力。',
    icon: PuzzleIcon,
    layout: 'manager',
  },
]
