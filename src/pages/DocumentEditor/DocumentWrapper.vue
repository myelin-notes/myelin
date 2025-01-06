<script setup lang="ts">
import DocumentView from "./DocumentView.vue";

defineProps<{
  path: string[],
}>();
</script>

<template>
  <Suspense>
    <DocumentView :path="path"/>
    <template #fallback>
      Loading
    </template>
  </Suspense>
</template>

<style scoped>
</style>