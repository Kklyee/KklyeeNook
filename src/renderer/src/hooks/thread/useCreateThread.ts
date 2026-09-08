import { useMutation, useQueryClient } from '@tanstack/react-query'
import { threadKeys } from './useThreads'

export const useCreateThread = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (title?: string) => {
      const newThread = await window.api.createAgentSession(title)
      return newThread
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKeys.all })
    },
  })
}
