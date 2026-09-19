/** The one vivid color a pool gets. Everything else stays monochrome. */
export interface Vibe {
  name: string
  accent: string
  onAccent: string
  soft: string
}

export const VIBES: Vibe[] = [
  { name: 'Lime', accent: '#C8FF3D', onAccent: '#0B0B0B', soft: '#EFFFC4' },
  { name: 'Hot pink', accent: '#FF3D8A', onAccent: '#FFFFFF', soft: '#FFD9E7' },
  { name: 'Violet', accent: '#8B5CFF', onAccent: '#FFFFFF', soft: '#E4D9FF' },
  { name: 'Orange', accent: '#FF6B2C', onAccent: '#0B0B0B', soft: '#FFDCCB' },
  { name: 'Mint', accent: '#2BF29A', onAccent: '#0B0B0B', soft: '#CFFBE6' },
  { name: 'Sky', accent: '#4DB2FF', onAccent: '#0B0B0B', soft: '#D6ECFF' },
]

export const vibeOf = (i: number) => VIBES[Math.abs(i) % VIBES.length]

export const vibeStyle = (i: number): React.CSSProperties => {
  const v = vibeOf(i)
  return {
    ['--accent' as string]: v.accent,
    ['--on-accent' as string]: v.onAccent,
    ['--accent-soft' as string]: v.soft,
  }
}

export const EMOJIS = ['🏡', '🎉', '✈️', '🎂', '🎸', '🏕️', '🐶', '🎓', '⚽', '🍕', '🎁', '🚀']
