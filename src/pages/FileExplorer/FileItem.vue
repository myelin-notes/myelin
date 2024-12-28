<script setup lang="ts">
import {MyelinFile} from "../../ts/utils/MyelinFile.ts";
const props = defineProps<{ file?: MyelinFile }>();
</script>

<template>
  <div id="item" class="foreground-item">
    <div id="title">
      <svg class=icon xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" fill="currentColor">
        <path
            fill="currentColor"
            d="m499-287 335-335-52-52-335 335 52 52Zm-261 87q-100-5-149-42T40-349q0-65 53.5-105.5T242-503q39-3 58.5-12.5T320-542q0-26-29.5-39T193-600l7-80q103 8 151.5 41.5T400-542q0 53-38.5 83T248-423q-64 5-96 23.5T120-349q0 35 28 50.5t94 18.5l-4 80Zm280 7L353-358l382-382q20-20 47.5-20t47.5 20l70 70q20 20 20 47.5T900-575L518-193Zm-159 33q-17 4-30-9t-9-30l33-159 165 165-159 33Z"/>
      </svg>
      <span>{{ props.file?.title }}</span>
    </div>
    <img :src="props.file?.preview">
  </div>
</template>

<style scoped>
svg path {
  color: var(--c-icons);
}

svg {
  width: 32px;
  margin-right: -8px;
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
