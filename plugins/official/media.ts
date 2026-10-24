import { defineSourcePlugin } from '../sdk/define'
import { biliSource, youtubeSource } from './media/adapter'

export const biliPlugin = defineSourcePlugin(
  {
    id: 'bili',
    displayName: 'Bilibili',
    capabilities: ['download'],
    downloadDomains: ['bilibili.com']
  },
  () => biliSource
)
export const youtubePlugin = defineSourcePlugin(
  {
    id: 'youtube',
    displayName: 'YouTube',
    capabilities: ['download'],
    downloadDomains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com']
  },
  () => youtubeSource
)
