export const highlightText = (text: string, keyword: string): string => {
  if (!keyword) return text
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedKeyword})`, 'ig')
  return text.replace(regex, '<mark class="bg-yellow-400 text-black">$1</mark>')
}
