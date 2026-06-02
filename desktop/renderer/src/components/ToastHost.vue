<template>
  <div class="toast" :class="[ui.toastShown ? 'show' : '', ui.toastCls]">{{ ui.toastMsg }}</div>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
const ui = useUiStore()
</script>
