import type { ComponentType } from 'react'
import {
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ImageIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TextSearchIcon,
} from 'lucide-react'

export type SettingsTab =
  | 'appearance'
  | 'model'
  | 'context'
  | 'permissions'
  | 'skills'
  | 'memory'
  | 'knowledge'
  | 'mcp'
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
    id: 'skills',
    label: 'Skills',
    description: '查看当前可用的 Skills。',
    icon: SparklesIcon,
    layout: 'manager',
  },
  {
    id: 'memory',
    label: 'Memory',
    description: '查看和管理长期记忆。',
    icon: BrainIcon,
    layout: 'manager',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description: '导入文档并管理知识来源。',
    icon: BookOpenIcon,
    layout: 'manager',
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    description: '配置 MCP 服务和工具连接。',
    icon: ServerIcon,
    layout: 'manager',
  },
]
