import type { ImageMessagePartComponent } from '@assistant-ui/react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../components/dialog'

export const ImageThumbnail: ImageMessagePartComponent = ({ image, filename }) => (
  <Dialog>
    <DialogTrigger
      aria-label={`View ${filename || 'image'}`}
      className="block size-20 cursor-zoom-in overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img src={image} alt={filename || 'Image attachment'} className="size-full object-cover" />
    </DialogTrigger>
    <DialogContent
      initialFocus={false}
      className="w-[calc(100%-2rem)] max-w-none p-2 sm:max-w-[calc(100%-2rem)]"
    >
      <DialogTitle className="sr-only">{filename || 'Image attachment'}</DialogTitle>
      <img
        src={image}
        alt={filename || 'Image attachment'}
        className="mx-auto block h-auto max-h-[85dvh] w-auto max-w-full object-contain"
      />
    </DialogContent>
  </Dialog>
)
