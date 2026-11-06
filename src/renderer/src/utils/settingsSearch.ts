export interface SettingsSearchEntry {
  id: string
  sectionId: string
  title: string
  path: string[]
  description: string
  target: HTMLElement
  fields: { title: string; path: string; description: string; body: string }
}

export function normalizeSettingsSearch(value: string): string {
  return value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Link rendered text to every translation of the same message key. */
export function createSettingsSearchTranslator(messages: unknown[]): (parts: string[]) => string {
  const translations = new Map<string, Set<string>>()
  function collect(value: unknown, path = ''): void {
    if (typeof value === 'string') {
      const values = translations.get(path) ?? new Set<string>()
      values.add(value)
      translations.set(path, values)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value))
        collect(child, path ? `${path}.${key}` : key)
    }
  }
  messages.forEach((message) => collect(message))
  const exact = new Map<string, Set<string>>()
  const templates: { pattern: RegExp; aliases: string[] }[] = []
  for (const values of translations.values()) {
    const aliases = [...values].map((value) =>
      normalizeSettingsSearch(value.replace(/\{[^}]+\}/g, ' '))
    )
    for (const value of values) {
      const normalized = normalizeSettingsSearch(value)
      if (/\{[^}]+\}/.test(normalized)) {
        const parts = normalized.split(/\{[^}]+\}/)
        if (parts.join('').length >= 4) {
          const pattern = parts
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.+?')
          templates.push({ pattern: new RegExp(`^${pattern}$`, 'u'), aliases })
        }
      } else {
        const linked = exact.get(normalized) ?? new Set<string>()
        aliases.forEach((alias) => linked.add(alias))
        exact.set(normalized, linked)
      }
    }
  }
  return (parts) => {
    const expanded = new Set(parts.map(normalizeSettingsSearch).filter(Boolean))
    for (const part of [...expanded]) {
      exact.get(part)?.forEach((alias) => expanded.add(alias))
      for (const template of templates)
        if (template.pattern.test(part)) template.aliases.forEach((alias) => expanded.add(alias))
    }
    return [...expanded].join(' ')
  }
}

const rowSelector =
  '.setting-row, .slider-row, .custom-background-color-control, .shortcut-binding-row'

function textParts(element: Element | null): string[] {
  if (!element) return []
  const parts: string[] = []
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.parentElement?.closest('svg, script, style, input, textarea'))
      if (node.textContent?.trim()) parts.push(node.textContent.trim())
  }
  for (const text of element.querySelectorAll('p, h3, h4, label'))
    if (text.textContent?.trim()) parts.push(text.textContent.trim())
  return parts
}

export function indexSettings(
  root: HTMLElement,
  translate: (parts: string[]) => string
): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = []
  for (const section of root.querySelectorAll<HTMLElement>('.settings-section[id]')) {
    const sectionTitle = section.querySelector('h2')?.textContent?.trim() ?? ''
    const heading = section.querySelector<HTMLElement>('.section-heading')
    function add(
      target: HTMLElement,
      title: string,
      path: string[],
      description: string,
      body: string[]
    ): void {
      if (!title || !target.getClientRects().length) return
      entries.push({
        id: `${section.id}-${entries.length}`,
        sectionId: section.id,
        title,
        path,
        description,
        target,
        fields: {
          title: translate([title]),
          path: translate(path),
          description: translate([description]),
          body: translate(body)
        }
      })
    }
    if (heading)
      add(heading, sectionTitle, [], heading.querySelector('p')?.textContent?.trim() ?? '', [])
    for (const group of section.querySelectorAll<HTMLElement>('.settings-group')) {
      const title = group.querySelector<HTMLElement>(':scope > .settings-group-title')
      if (title) add(title, title.textContent?.trim() ?? '', [sectionTitle], '', [])
    }
    for (const row of section.querySelectorAll<HTMLElement>(rowSelector)) {
      const group = row
        .closest('.settings-group')
        ?.querySelector(':scope > .settings-group-title')
        ?.textContent?.trim()
      const label = row
        .querySelector('h3, h4, .action, .slider-label > span, :scope > span')
        ?.textContent?.trim()
      add(
        row,
        label || group || sectionTitle,
        [sectionTitle, group].filter((value): value is string => Boolean(value)),
        row.querySelector('p')?.textContent?.trim() ?? '',
        textParts(row)
      )
    }
    // Include standalone explanatory text outside settings rows, including links and notes.
    for (const paragraph of section.querySelectorAll<HTMLElement>('p, li')) {
      if (paragraph.closest(rowSelector) || paragraph.closest('.section-heading')) continue
      const group = paragraph
        .closest('.settings-group')
        ?.querySelector(':scope > .settings-group-title')
        ?.textContent?.trim()
      const description = paragraph.textContent?.trim() ?? ''
      add(
        paragraph,
        group || sectionTitle,
        [sectionTitle, group].filter((value): value is string => Boolean(value)),
        description,
        textParts(paragraph)
      )
    }
  }
  return entries
}

export function searchSettings(
  entries: SettingsSearchEntry[],
  query: string
): SettingsSearchEntry[] {
  const tokens = normalizeSettingsSearch(query)
    .split(/[\s>/›]+/)
    .filter(Boolean)
  if (!tokens.length) return []
  return entries
    .map((entry, order) => {
      let score = 0
      for (const token of tokens) {
        const match = entry.fields.title.includes(token)
          ? 100
          : entry.fields.path.includes(token)
            ? 45
            : entry.fields.description.includes(token)
              ? 25
              : entry.fields.body.includes(token)
                ? 10
                : 0
        if (!match) return { entry, score: 0, order }
        score += match
      }
      return { entry, score, order }
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((match) => match.entry)
}
