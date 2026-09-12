export type ModelInput = 'text' | 'image'

const DEEPSEEK_V41_IMAGE_MODEL_IDS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
])

export function resolveModelInput(
  provider: string,
  modelID: string,
  declaredInput: readonly ModelInput[],
): ModelInput[] {
  const input = [...declaredInput]
  if (
    provider.toLowerCase() === 'deepseek' &&
    DEEPSEEK_V41_IMAGE_MODEL_IDS.has(modelID.toLowerCase()) &&
    !input.includes('image')
  ) {
    input.push('image')
  }
  return input
}
