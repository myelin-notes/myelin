<script setup lang="ts">
import Breadcrumb from "./Breadcrumb.vue";
import FolderAndFiles from "./FolderAndFiles.vue";
import {FileSystem} from "../../ts/utils/FileSystem.ts";
import {ref, watch} from "vue";

const props = defineProps<{ path: string[], }>();
const entries = ref(await FileSystem.load(props.path.slice(1)));

watch(() => props.path, async (newProp, _prevProp) => {
  entries.value = await FileSystem.load(newProp.slice(1));
});
</script>

<template>
  <main>
    <div id="top-bar">
      <div id="left">
        <div id="breadcrumb" class="bubble">
          <Breadcrumb :path="path"></Breadcrumb>
        </div>
      </div>
      <div id="right">
        <button id="create" class="foreground-item">
          <span class="icon pi pi-pencil"/>
        </button>
      </div>
    </div>
    <FolderAndFiles
        :directories="entries[0]"
        :files="entries[1]"
        :path="props.path"/>
  </main>
</template>

<style scoped>
main {
  padding: 32px;
  gap: var(--p-gap-same-context);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  box-sizing: border-box;

  /* Add this to prevent expanding */
  min-height: 0;
  overflow: hidden;
}

#top-bar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  align-self: stretch;
}

#top-bar #right #create {
  transition: var(--p-transition);
}

#top-bar #right #create:hover {
  background-color: var(--c-primary);
}
</style>