import { useMutation } from '@tanstack/react-query';

export function useSubmitPrompt() {
  return useMutation({
    mutationFn: (prompt: string) => {
      return window.api.submitPrompt(prompt);
    },
  });
}
