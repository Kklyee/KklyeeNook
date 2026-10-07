'use client'

import { useEffect, useState } from 'react'
import { useAuiState } from '@assistant-ui/react'

const useFileSrc = (file: File | undefined) => {
  const [entry, setEntry] = useState<{ file: File; url: string } | undefined>(undefined)

  useEffect(() => {
    if (!file) {
      setEntry(undefined)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setEntry({ file, url: objectUrl })

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  return entry !== undefined && entry.file === file ? entry.url : undefined
}

export const useAttachmentSrc = () => {
  const file = useAuiState(s => s.attachment.type === 'image' ? s.attachment.file : undefined)
  const src = useAuiState(s => s.attachment.type === 'image' ? s.attachment.content?.find(part => part.type === 'image')?.image : undefined)
  return useFileSrc(file) ?? src
}
