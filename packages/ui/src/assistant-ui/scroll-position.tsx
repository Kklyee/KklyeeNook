export interface ScrollPosition {
  top: number
  following: boolean
}

export const scrollPositions = new Map<string, ScrollPosition>()
