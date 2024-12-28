<script setup lang="ts">
import DocumentView from "./DocumentView.vue";

defineProps<{
  path: string[],
}>();
</script>

<template>
  <DocumentView :path="path"/>
</template>

<style scoped>
</style>