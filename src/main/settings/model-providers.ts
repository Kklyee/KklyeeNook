import type { Provider } from '@earendil-works/pi-ai/models'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

export function applicationProviders(): Provider[] {
  return builtinProviders().map((provider) => {
    if (provider.id !== 'deepseek') return provider
    const current = provider.getModels()
    const flash = current.find((model) => model.id === 'deepseek-flash')
    if (!flash || current.some((model) => model.id === 'deepseek-v4-flash')) return provider
    const alias = { ...flash, id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
    return {
      ...provider,
      getModels: () => [...current, alias],
      getAllModels: () => [...(provider.getAllModels?.() ?? current), alias],
      stream: (model, context, options) => provider.stream(
        model.id === alias.id ? { ...model, id: flash.id } : model, context, options,
      ),
      streamSimple: (model, context, options) => provider.streamSimple(
        model.id === alias.id ? { ...model, id: flash.id } : model, context, options,
      ),
    }
  })
}
