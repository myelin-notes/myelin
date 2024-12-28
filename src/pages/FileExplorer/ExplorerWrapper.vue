<script setup lang="ts">
import ExplorerPage from "./ExplorerPage.vue";

defineProps<{
  path: string[],
}>();
</script>

<template>
<Suspense>
  <ExplorerPage :path="path"/>
  <template #fallback>
    Loading
  </template>
</Suspense>
</template>

<style scoped>

</style>