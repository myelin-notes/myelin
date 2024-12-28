<script setup lang="ts">
import {MyelinFile} from "../../ts/utils/FileSystem.ts";

defineProps<{
  file?: MyelinFile,
  link?: string,
}>();
</script>

<template>
  <RouterLink id="item" class="foreground-item" :to="`/${file?.type === 'mcanvas' ? 'canvas' : 'document'}/${link}`">
    <div id="title">
      <svg v-if="file?.type === 'mcanvas'" class="icon" xmlns="http://www.w3.org/2000/svg" height="24px"
           viewBox="0 -960 960 960" fill="currentColor">
        <path
            fill="currentColor"
            d="m499-287 335-335-52-52-335 335 52 52Zm-261 87q-100-5-149-42T40-349q0-65 53.5-105.5T242-503q39-3 58.5-12.5T320-542q0-26-29.5-39T193-600l7-80q103 8 151.5 41.5T400-542q0 53-38.5 83T248-423q-64 5-96 23.5T120-349q0 35 28 50.5t94 18.5l-4 80Zm280 7L353-358l382-382q20-20 47.5-20t47.5 20l70 70q20 20 20 47.5T900-575L518-193Zm-159 33q-17 4-30-9t-9-30l33-159 165 165-159 33Z"/>
      </svg>
      <svg v-else-if="file?.type === 'mdoc'" class="icon" id="doc-icon" xmlns="http://www.w3.org/2000/svg"
           viewBox="0 0 384 512">
        <path
            fill="currentColor"
            d="M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 288c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm384 64l-128 0L256 0 384 128z"/>
      </svg>
      <span>{{ file?.name }}</span>
    </div>
    <img :src="file?.preview">
  </RouterLink>
</template>

<style scoped>
svg path {
  color: var(--c-icons);
}

svg {
  height: 24px;
  margin-right: -8px;
}

#doc-icon {
  padding-right: 8px;
}

#title {
  display: flex;
  flex-direction: row;
  justify-content: start;
  align-items: center;
  gap: var(--p-gap-same-context);
  width: 100%;
  box-sizing: border-box;
  padding: var(--p-padding-reg);
}

#item {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 0;
  transition: var(--p-transition);
}

#item:hover {
  background-color: var(--c-primary);
  cursor: pointer;
}

#item img {
  width: 100%;
  aspect-ratio: 1;
  background-color: white;
  border-radius: 0 0 var(--p-border-radius) var(--p-border-radius);
}
</style>
