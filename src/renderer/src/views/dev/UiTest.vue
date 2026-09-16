<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from '@/components/ui/useMessage'
import BaseColorPicker from '@/components/ui/BaseColorPicker.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

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
            drawerDir = 'right'
            drawerNoTitle = false
            drawerVisible = true
          "
          >右侧 (有标题)</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            drawerDir = 'left'
            drawerNoTitle = true
            drawerVisible = true
          "
          >左侧 (无标题)</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            drawerDir = 'top'
            drawerNoTitle = false
            drawerVisible = true
          "
          >顶部</BaseButton
        >
        <BaseButton
          variant="secondary"
          size="sm"
          @click="
            drawerDir = 'bottom'
            drawerNoTitle = false
            drawerVisible = true
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

    <BaseMessage />
    <div class="h-80" />
  </div>
</template>
