export interface HighlightPart {
  text: string
  highlighted: boolean
}

export const getHighlightParts = (text: string, keyword: string): HighlightPart[] => {
  if (!keyword) return [{ text, highlighted: false }]
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escapedKeyword, 'ig')
  const parts: HighlightPart[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex)
      parts.push({ text: text.slice(lastIndex, match.index), highlighted: false })
    parts.push({ text: match[0], highlighted: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), highlighted: false })
  return parts.length ? parts : [{ text, highlighted: false }]
}
