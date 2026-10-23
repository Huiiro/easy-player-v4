<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import eventBus from '@/utils/eventBus'

const GlobalSearchDialog = defineAsyncComponent(() => import('./GlobalSearchDialog.vue'))
const loaded = ref(false)
const visible = ref(false)
const dialog = ref<InstanceType<typeof GlobalSearchDialog> | null>(null)

function open(): void {
  loaded.value = true
  visible.value = true
  void nextTick(() => dialog.value?.focusSearch())
}

eventBus.on('openGlobalSearch', open)
onBeforeUnmount(() => eventBus.off('openGlobalSearch', open))
</script>

<template>
  <GlobalSearchDialog v-if="loaded" ref="dialog" v-model="visible" />
</template>
