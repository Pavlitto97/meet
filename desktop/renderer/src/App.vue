<template>
  <router-view />
  <UpdateBanner />
  <ToastHost />
  <DialogHost />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ToastHost from '@/components/ToastHost.vue'
import DialogHost from '@/components/DialogHost.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import { useUpdatesStore } from '@/stores/updates'

// Підписка на статус апдейтера — один раз на життя застосунку.
onMounted(() => { void useUpdatesStore().init() })
</script>
