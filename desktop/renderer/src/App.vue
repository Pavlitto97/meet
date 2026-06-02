<template>
  <router-view />
  <ToastHost />
  <DialogHost />
</template>

<script setup lang="ts">
import ToastHost from '@/components/ToastHost.vue'
import DialogHost from '@/components/DialogHost.vue'
</script>
