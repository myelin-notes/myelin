<script lang="ts" setup>
import {ref, computed} from 'vue'
import Home from "./pages/Home.vue";
import FreeCanvas from "./pages/FreeCanvas.vue";

const routes = {
  // '/': Home,
  '/': FreeCanvas,
}

const currentPath = ref(window.location.hash)

window.addEventListener('hashchange', () => {
  currentPath.value = window.location.hash
})

const currentView = computed(() => {
  // @ts-ignore
  return routes[currentPath.value.slice(1) || '/']
})
</script>

<template>
  <component :is="currentView" />
</template>