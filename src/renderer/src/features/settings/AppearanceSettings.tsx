import { ImageIcon } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { SettingsCard, SettingsField } from './SettingsComponents'
import { useWallpaper } from './useWallpaper'
import { useTheme } from './useTheme'

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { image, loading, error, choose, clear } = useWallpaper()
  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsField label="主题" description="选择浅色、深色，或跟随系统外观。">
          <div role="group" aria-label="应用主题" className="material-control flex rounded-lg p-1">
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                aria-pressed={theme === mode}
                className={`flex-1 ${theme === mode ? 'bg-selected text-foreground' : ''}`}
                onClick={() => setTheme(mode)}
              >
                {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
              </Button>
            ))}
          </div>
        </SettingsField>
      </SettingsCard>
      <SettingsCard>
        <SettingsField label="应用壁纸" description="为整个窗口铺上壁纸，叠加柔和模糊、细噪点和半透明材质。">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button variant="outline" disabled={loading} onClick={() => void choose()}>
              <ImageIcon className="size-4" />
              {loading ? '正在处理…' : image ? '更换壁纸' : '选择壁纸'}
            </Button>
            {image && (
              <Button variant="ghost" disabled={loading} onClick={() => void clear()}>
                移除壁纸
              </Button>
            )}
          </div>
        </SettingsField>
        {image && (
          <div className="p-4">
            <img src={image} alt="当前应用壁纸" className="aspect-video w-full rounded-lg object-cover" />
          </div>
        )}
      </SettingsCard>
      <p className="text-muted-foreground text-xs">壁纸保存在本机，移除后恢复系统材质。系统关闭透明效果时使用实色背景。</p>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>
  )
}
