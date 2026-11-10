<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseRange from '@/components/ui/BaseRange.vue'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BasePopover from '@/components/ui/BasePopover.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import BaseBackTop from '@/components/ui/BaseBackTop.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import { STUDIO_BLUR_RADIUS } from '@/services/liquidGlassProfile'
import {
  THEME_GLASS_TOKENS,
  THEME_BACKTOP_TOKENS,
  THEME_TOOLTIP_TOKENS
} from '../../../../../packages/plugin-sdk/src'

const ui = useUIStore()
const previewTokenCatalog = {
  ...THEME_GLASS_TOKENS,
  ...THEME_BACKTOP_TOKENS,
  ...THEME_TOOLTIP_TOKENS
}
const message = useMessage()
const enabled = computed({
  get: () => ui.interfaceEffect === 'liquid-glass-studio',
  set: (value: boolean) => {
    ui.interfaceEffect = value ? 'liquid-glass-studio' : 'none'
  }
})
const disabled = ref(false)
const checked = ref(true)
const value = ref(45)
const text = ref('Liquid Glass')
const color = ref('#50A8E8CC')
const selection = ref('one')
const selectOptions = [
  { label: '选项一', value: 'one' },
  ...Array.from({ length: 40 }, (_, index) => ({
    label: `滚动选项 ${index + 2}`,
    value: `item-${index}`,
    disabled: index % 10 === 0
  }))
]
const dialog = ref(false)
const demoVolume = ref(65)
const demoSpeed = ref(1)
const backTopDemo = ref<HTMLElement | null>(null)
const backTopDemoTarget = (): HTMLElement | null => backTopDemo.value
function showBackTopDemo(): void {
  backTopDemo.value?.scrollTo({ top: 400, behavior: 'auto' })
}
const blur = ref<number>(STUDIO_BLUR_RADIUS)
const radius = ref(16)
const tint = ref(12)
const temporary = ref(false)
const owned = new Map<string, { value: string; priority: string; applied: string }>()
const notices = new Set<number>()
const tokens = computed(() => ({
  '--ep-glass-floating-blur-radius': String(blur.value),
  '--ep-glass-floating-radius': `${radius.value}px`,
  '--ep-glass-message-radius': `${radius.value}px`,
  '--ep-glass-floating-tint': `${tint.value}%`
}))
const snippet = computed(() =>
  JSON.stringify(
    {
      tokens: tokens.value,
      rules: {
        '.ep-color-trigger': { 'border-radius': 'var(--ep-glass-control-radius, 10px)' },
        '.ep-message': { 'border-radius': 'var(--ep-glass-message-radius, 16px)' }
      }
    },
    null,
    2
  )
)

function applyPreview(): void {
  const style = document.documentElement.style
  for (const [name, value] of Object.entries(tokens.value)) {
    const previous = owned.get(name)
    owned.set(name, {
      value: previous?.value ?? style.getPropertyValue(name),
      priority: previous?.priority ?? style.getPropertyPriority(name),
      applied: value
    })
    style.setProperty(name, value, 'important')
  }
  temporary.value = true
}
function resetPreview(): void {
  const style = document.documentElement.style
  for (const [name, previous] of owned) {
    if (
      style.getPropertyValue(name) !== previous.applied ||
      style.getPropertyPriority(name) !== 'important'
    )
      continue
    if (previous.value) style.setProperty(name, previous.value, previous.priority)
    else style.removeProperty(name)
  }
  owned.clear()
  temporary.value = false
}
function notify(type: 'info' | 'success' | 'warning' | 'error'): void {
  notices.add(
    message.add({ type, message: `Liquid Glass · ${type}`, showClose: true, duration: 6000 })
  )
}
function cleanup(): void {
  resetPreview()
  notices.forEach((id) => message.remove(id))
  notices.clear()
  dialog.value = false
}
onMounted(() => {
  const css = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: number): number => {
    const value = parseFloat(css.getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }
  blur.value = read('--ep-glass-floating-blur-radius', STUDIO_BLUR_RADIUS)
  radius.value = read('--ep-glass-floating-radius', 16)
  tint.value = read('--ep-glass-floating-tint', 12)
})
onDeactivated(cleanup)
onBeforeUnmount(cleanup)
</script>

<template>
  <section class="space-y-4" aria-label="Liquid Glass 组件预览">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold">Liquid Glass 组件预览</h2>
        <p class="mt-1 text-sm text-text-l">开关与外观设置同步，可叠加当前主题和自定义背景。</p>
      </div>
      <BaseSwitch
        v-model="enabled"
        :disabled="ui.nativeMaterialEnabled || ui.extremePlayback"
        aria-label="Liquid Glass 样式效果"
      />
    </div>
    <p v-if="ui.nativeMaterialEnabled || ui.extremePlayback" class="text-sm text-text-l">
      原生材质或极致播放模式下暂停玻璃效果。
    </p>
    <div class="glass-preview-scene rounded-3xl p-5">
      <div class="ep-glass-panel relative space-y-5 rounded-2xl border border-border p-5">
        <div class="flex flex-wrap items-center gap-3">
          <BaseButton>主要按钮</BaseButton><BaseButton variant="secondary">玻璃按钮</BaseButton>
          <BaseButton variant="danger">危险操作</BaseButton><BaseButton disabled>禁用</BaseButton>
          <BaseSwitch v-model="disabled" active-text="禁用控件" inactive-text="启用控件" />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <BaseInput v-model="text" :disabled="disabled" aria-label="玻璃输入框" />
          <BaseSelect v-model="selection" teleport :disabled="disabled" :options="selectOptions" />
          <BaseSwitch
            v-model="checked"
            :disabled="disabled"
            active-text="开启"
            inactive-text="关闭"
          />
          <BaseColorPicker v-model="color" teleport show-alpha :disabled="disabled" />
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <label class="space-y-2 text-sm"
            >滑块 · {{ value }}<BaseSlider v-model="value" :disabled="disabled"
          /></label>
          <label class="space-y-2 text-sm"
            >原生进度条 · {{ value }}<BaseRange v-model="value" class="w-full" :disabled="disabled"
          /></label>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <BaseTooltip
            content="共享主题配色，开启 Liquid Glass 后使用玻璃材质。"
            :disabled="disabled"
          >
            <template #trigger="{ triggerProps }">
              <BaseButton v-bind="triggerProps" :disabled="disabled" variant="secondary"
                >文字提示</BaseButton
              >
            </template>
          </BaseTooltip>
          <BaseTooltip interactive variant="control" aria-label="演示音量" :disabled="disabled">
            <template #trigger="{ triggerProps }">
              <BaseButton v-bind="triggerProps" :disabled="disabled" variant="secondary"
                >音量 {{ demoVolume }}%</BaseButton
              >
            </template>
            <b>{{ demoVolume }}%</b>
            <input
              v-model.number="demoVolume"
              type="range"
              min="0"
              max="100"
              aria-label="演示音量"
            />
          </BaseTooltip>
          <BaseTooltip interactive variant="control" aria-label="演示倍速" :disabled="disabled">
            <template #trigger="{ triggerProps }">
              <BaseButton v-bind="triggerProps" :disabled="disabled" variant="secondary"
                >倍速 {{ demoSpeed.toFixed(1) }}×</BaseButton
              >
            </template>
            <b>{{ demoSpeed.toFixed(1) }}×</b>
            <input
              v-model.number="demoSpeed"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              aria-label="演示倍速"
            />
          </BaseTooltip>
          <BasePopover teleport title="玻璃浮层" content="真实页面折射、主题配色和清晰内容。"
            ><template #trigger
              ><BaseButton variant="secondary">打开浮层</BaseButton></template
            ></BasePopover
          >
          <BaseButton variant="secondary" @click="dialog = true">打开弹窗</BaseButton>
          <BaseButton
            v-for="type in ['info', 'success', 'warning', 'error'] as const"
            :key="type"
            variant="secondary"
            @click="notify(type)"
            >{{ type }} 消息</BaseButton
          >
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <BaseSkeleton type="row" :size="40" /><BaseSkeleton :size="56" :animated="false" />
        </div>
      </div>
    </div>
    <BaseDialog v-model="dialog" title="Liquid Glass 弹窗">
      <p class="mb-4 text-sm text-text-l">
        检查遮罩透底、颜色面板与消息叠加。文字和输入内容保持清晰。
      </p>
      <BaseInput v-model="text" aria-label="弹窗输入框" />
      <div class="mt-4 flex gap-3">
        <BaseColorPicker v-model="color" teleport show-alpha /><BaseButton
          variant="secondary"
          @click="notify('info')"
          >消息通知</BaseButton
        >
      </div>
    </BaseDialog>
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h3 class="font-medium">BaseBackTop · 独立滚动容器</h3>
        <BaseButton variant="secondary" @click="showBackTopDemo">滚动以显示回到顶部</BaseButton>
      </div>
      <div class="relative rounded-2xl border border-border" style="height: 180px">
        <div ref="backTopDemo" class="custom-scrollbar h-full overflow-y-auto rounded-2xl p-4">
          <div style="height: 720px" class="space-y-6 text-sm text-text-l">
            <p>在此区域滚动超过 80px 后显示玻璃按钮。</p>
            <p v-for="row in 12" :key="row">
              滚动示例 {{ row }} · 点击箭头平滑返回这个容器的顶部。
            </p>
          </div>
        </div>
        <BaseBackTop
          :target="backTopDemoTarget"
          :visibility-height="80"
          position="absolute"
          :bottom="12"
          :right="12"
          aria-label="回到演示区域顶部"
        />
      </div>
    </div>
    <details class="rounded-xl border border-border p-4">
      <summary class="cursor-pointer font-medium">插件属性与临时参数预览</summary>
      <p class="my-3 text-sm text-text-l">
        点击应用后预览全局浮层；恢复或离开此页会清理临时变量，不修改主题文件。
      </p>
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="text-sm"
          >模糊半径 {{ blur }}<BaseRange v-model="blur" :max="200" class="w-full"
        /></label>
        <label class="text-sm"
          >浮层圆角 {{ radius }}px<BaseRange v-model="radius" :max="40" class="w-full"
        /></label>
        <label class="text-sm"
          >浮层染色 {{ tint }}%<BaseRange v-model="tint" :max="50" class="w-full"
        /></label>
      </div>
      <div class="my-3 flex gap-3">
        <BaseButton variant="secondary" @click="applyPreview">应用预览变量</BaseButton
        ><BaseButton variant="ghost" :disabled="!temporary" @click="resetPreview"
          >恢复主题变量</BaseButton
        >
      </div>
      <p class="mb-2 text-sm text-text-l">以下片段可合并进主题 JSON 的 tokens / rules。</p>
      <pre class="max-h-64 overflow-auto rounded-lg bg-bg-d p-3 text-xs select-text" tabindex="0">{{
        snippet
      }}</pre>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr>
              <th class="p-2">插件属性</th>
              <th class="p-2">用途</th>
              <th class="p-2">缺省值</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(spec, name) in previewTokenCatalog"
              :key="name"
              class="border-t border-border"
            >
              <td class="p-2 font-mono select-text">{{ name }}</td>
              <td class="p-2">{{ spec.description }}</td>
              <td class="p-2 font-mono">
                {{ name === '--ep-glass-floating-blur-radius' ? STUDIO_BLUR_RADIUS : spec.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>

<style scoped>
.glass-preview-scene {
  background:
    radial-gradient(circle at 15% 25%, #df658ab3, transparent 55%),
    radial-gradient(circle at 85% 75%, #56b4e9cc, transparent 55%),
    linear-gradient(135deg, #493779, #194c60 65%, #629c88);
}
</style>
