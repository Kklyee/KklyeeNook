import type { ComponentType } from 'react'
import { BotIcon, ImageIcon, PuzzleIcon, SlidersHorizontalIcon, SmartphoneIcon } from 'lucide-react'

export type SettingsTab = 'appearance' | 'remote' | 'model' | 'agent' | 'plugins'
export type SettingsLayout = 'preferences' | 'manager'

export type SettingsNavigationItem = {
  id: SettingsTab
  group: '应用' | 'Agent' | '扩展'
  label: string
  description: string
  keywords: string
  icon: ComponentType<{ className?: string }>
  layout: SettingsLayout
}

export const settingsNavigation: SettingsNavigationItem[] = [
  {
    id: 'appearance',
    group: '应用',
    label: '外观',
    description: '自定义壁纸、主题和窗口的毛玻璃效果。',
    keywords: 'appearance theme wallpaper 主题 壁纸 毛玻璃',
    icon: ImageIcon,
    layout: 'preferences',
  },
  {
    id: 'remote',
    group: '应用',
    label: '远程访问',
    description: '通过 Tailscale 在手机上使用 Desktop Agent。',
    keywords: 'remote tailscale 手机 连接',
    icon: SmartphoneIcon,
    layout: 'preferences',
  },
  {
    id: 'model',
    group: 'Agent',
    label: '模型',
    description: '管理模型提供商、可用模型和默认模型。',
    keywords: 'model provider api key 提供商 密钥',
    icon: BotIcon,
    layout: 'manager',
  },
  {
    id: 'agent',
    group: 'Agent',
    label: 'Agent 设置',
    description: '配置上下文、网络搜索和操作权限。',
    keywords:
      'context compaction web search permission tavily exa api key 上下文 自动压缩 高级参数 网络搜索 权限 安全 临时授权',
    icon: SlidersHorizontalIcon,
    layout: 'preferences',
  },
  {
    id: 'plugins',
    group: '扩展',
    label: '插件',
    description: '管理技能、记忆、MCP 和知识库，扩展 Agent 的能力。',
    keywords: 'plugins skills memory mcp knowledge 技能 记忆 知识库',
    icon: PuzzleIcon,
    layout: 'manager',
  },
]
