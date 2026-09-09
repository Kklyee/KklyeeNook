import type { ReactNode } from 'react'

interface ToolCardProps {
  icon?: ReactNode
  title: string
  description?: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  children?: ReactNode
}

export function ToolCard({ icon, title, description, status, children }: ToolCardProps) {
  const statusText = { running: '执行中...', success: '完成', error: '失败', cancelled: '已取消' }[
    status
  ]

  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 10,
        padding: 12,
        margin: '8px 0',
        fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{icon}</span>
        <strong>{title}</strong>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{statusText}</span>
      </div>

      {description && <div style={{ marginTop: 6, opacity: 0.7 }}>{description}</div>}
      {children && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}
