<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from '@/components/ui/useMessage'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import BasePopover from '@/components/ui/BasePopover.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSkeleton from '@/components/ui/BaseSkeleton.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
const inputValue = ref('可清除文本')
const confirming = ref(false)
const menuValue = ref('one')
const confirmAction = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

const { success, warning, info, error } = useMessage()

// ==================== Slider ====================
const sliderVal = ref(50)
const sliderVert = ref(30)
const sliderMark = ref(0)
const sliderXs = ref(60)
const sliderTransform = ref(0)
const sliderMarks = { 0: '0', 25: '25%', 50: '50%', 75: '75%', 100: '100%' }

// ==================== Drawer ====================
const drawerVisible = ref(false)
const drawerDir = ref<'left' | 'right' | 'top' | 'bottom'>('right')
const drawerNoTitle = ref(false)

// ==================== Switch ====================
const switchVal = ref(true)
const switchDisabled = ref(false)
const switchCustom = ref('on')

// ==================== Select ====================
const selectVal = ref('')
const widthOptions = [
  { label: '很长的选项文本应在固定宽度和弹性容器内截断，不撑开布局', value: 'long' }
]
const selectOptions = [
  { label: '选项一', value: '1' },
  { label: '选项二', value: '2' },
  { label: '选项三（禁用）', value: '3', disabled: true }
]

// ==================== ColorPicker ====================
const colorVal = ref('#4A90D9')
const colorAlpha = ref('#BD10E080')
const customPresets = [
  '#FF0000',
  '#00FF00',
  '#0000FF',
  '#FFFF00',
  '#FF00FF',
  '#00FFFF',
  '#000000',
  '#FFFFFF'
]
</script>

<template>
  <div class="p-6 space-y-10 text-text max-w-3xl mx-auto">
    <h1 class="text-2xl font-bold">UI 组件测试</h1>

    <section class="space-y-4">
      <h2 class="text-lg font-semibold">规范化控件与状态</h2>
      <div class="flex flex-wrap items-center gap-3">
        <BaseButton v-for="size in ['xs', 'sm', 'md', 'lg'] as const" :key="size" :size="size">{{
          size
        }}</BaseButton
        ><BaseButton loading>处理中</BaseButton><BaseButton disabled>禁用</BaseButton>
      </div>
      <BaseInput v-model="inputValue" /><BaseInput v-model="inputValue" disabled /><BaseInput
        v-model="inputValue"
        readonly
      /><BaseInput v-model="inputValue" invalid />
      <BaseSkeleton type="row" :size="40" />
      <BasePopover trigger="hover" teleport content="支持悬停、键盘、边界避让和滚动跟随"
        ><template #trigger
          ><span class="border rounded px-3 py-2">悬停浮层</span></template
        ></BasePopover
      >
      <BaseMenu
        v-model="menuValue"
        teleport
        :items="[
          { label: '选项一', value: 'one' },
          { label: '选项二', value: 'two' },
          { label: '不可选', value: 'disabled', disabled: true }
        ]"
        ><template #trigger
          ><button type="button" class="border rounded px-3 py-2">菜单</button></template
        ></BaseMenu
      >
      <BaseButton @click="confirming = true">异步确认</BaseButton>
      <BaseConfirmDialog
        v-model="confirming"
        title="异步操作"
        message="确认后等待一秒再关闭"
        confirm-text="确认"
        :confirm-action="confirmAction"
      />
    </section>

    <!-- ==================== BaseSlider ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseSlider</h2>
      <div>
        <p class="text-sm text-text-l mb-1">默认 (md) — {{ sliderVal }}</p>
        <BaseSlider v-model="sliderVal" />
      </div>
      <div>
        <p class="text-sm text-text-l mb-1">xs 尺寸 — {{ sliderXs }}</p>
        <BaseSlider v-model="sliderXs" size="xs" />
      </div>
      <div>
        <p class="text-sm text-text-l mb-1">带 marks — {{ sliderMark }}</p>
        <BaseSlider v-model="sliderMark" :marks="sliderMarks" :step="25" />
      </div>
      <div>
        <p class="text-sm text-text-l mb-1">垂直 — {{ sliderVert }}</p>
        <div class="h-40">
          <BaseSlider v-model="sliderVert" vertical />
        </div>
      </div>
      <div>
        <p class="text-sm text-text-l mb-1">transform (0-100 → 0-1): {{ sliderTransform }}</p>
        <BaseSlider
          v-model="sliderTransform"
          :transform="(v: number) => v / 100"
          :reverse-transform="(v: number) => v * 100"
        />
      </div>
    </section>

    <!-- ==================== BaseDrawer ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseDrawer</h2>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            () => {
              drawerDir = 'right'
              drawerNoTitle = false
              drawerVisible = true
            }
          "
          >右侧 (有标题)</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            () => {
              drawerDir = 'left'
              drawerNoTitle = true
              drawerVisible = true
            }
          "
          >左侧 (无标题)</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            () => {
              drawerDir = 'top'
              drawerNoTitle = false
              drawerVisible = true
            }
          "
          >顶部</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            () => {
              drawerDir = 'bottom'
              drawerNoTitle = false
              drawerVisible = true
            }
          "
          >底部</BaseButton
        >
      </div>
      <BaseDrawer
        v-model="drawerVisible"
        :direction="drawerDir"
        :title="drawerNoTitle ? undefined : '抽屉标题'"
        width="360px"
      >
        <p class="text-text-l">方向: {{ drawerDir }}</p>
      </BaseDrawer>
    </section>

    <!-- ==================== BaseSwitch ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseSwitch</h2>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">默认: {{ switchVal }}</span>
        <BaseSwitch v-model="switchVal" active-text="ON" inactive-text="OFF" />
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">禁用: {{ switchDisabled }}</span>
        <BaseSwitch v-model="switchDisabled" disabled />
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">自定义值: {{ switchCustom }}</span>
        <BaseSwitch v-model="switchCustom" active-value="on" inactive-value="off" />
      </div>
    </section>

    <!-- ==================== BaseSelect ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseSelect</h2>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">默认: {{ selectVal || '-' }}</span>
        <BaseSelect v-model="selectVal" :options="selectOptions" class="w-48" />
      </div>
      <div class="space-y-3 max-w-sm">
        <p class="text-sm text-text-l">固定宽度 / 撑满容器 / 弹性收缩</p>
        <BaseSelect model-value="long" :options="widthOptions" class="w-64" />
        <BaseSelect model-value="long" :options="widthOptions" class="w-full" teleport />
        <div class="flex gap-2">
          <BaseSelect model-value="long" :options="widthOptions" class="min-w-0 flex-1" />
          <BaseButton variant="secondary">操作</BaseButton>
        </div>
      </div>
    </section>

    <!-- ==================== BaseColorPicker ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseColorPicker</h2>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">默认:</span>
        <BaseColorPicker v-model="colorVal" />
        <span class="text-xs text-text-l2">{{ colorVal }}</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">带 Alpha:</span>
        <BaseColorPicker v-model="colorAlpha" show-alpha />
        <span class="text-xs text-text-l2">{{ colorAlpha }}</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-text-l">自定义预设:</span>
        <BaseColorPicker v-model="colorVal" :presets="customPresets" />
      </div>
    </section>

    <!-- ==================== BaseMessage ==================== -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold border-b border-border pb-2">BaseMessage</h2>
      <div class="flex flex-wrap gap-2">
        <BaseButton variant="primary" size="sm" @click="success('操作成功')">Success</BaseButton>
        <BaseButton variant="secondary" size="sm" @click="warning('请注意备份')"
          >Warning</BaseButton
        >
        <BaseButton variant="secondary" size="sm" @click="info('版本已更新')">Info</BaseButton>
        <BaseButton variant="danger" size="sm" @click="error('操作失败')">Error</BaseButton>
      </div>
    </section>

    <div class="h-80" />
  </div>
</template>
