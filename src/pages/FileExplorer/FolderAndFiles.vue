<script setup lang="ts">
import FolderItem from "./FolderItem.vue";
import FileItem from "./FileItem.vue";
import {MyelinFile} from "../../ts/utils/FileSystem.ts";
import {computed} from "vue";

const props = defineProps<{
  path: string[],
  directories: string[],
  files: MyelinFile[]
}>();

const slash = computed(() => props.path.length === 1 ? '' : '/');
</script>

<template>
  <div id="view" class="bubble">
    <div class="section">
      <h1>Folders</h1>
      <div v-if="directories.length > 0" class="items">
        <template v-for="dir in directories">
          <FolderItem
              :title="dir"
              :link="path.join('/') + `/${dir}`"/>
        </template>
      </div>
      <div v-else>
        <h2>Create a new folder</h2>
      </div>
    </div>
    <div class="section">
      <h1>Files</h1>
      <div v-if="files.length > 0" class="items">
        <template v-for="file in files">
          <FileItem
              :file="file"
              :link="path.slice(1).join('/') + `${slash}${file.name}.${file.type}`"/>
        </template>
      </div>
      <div v-else>
        <h2>Create a new file</h2>
      </div>
    </div>
  </div>
</template>

<style scoped>
#view {
  flex-grow: 1;
  align-self: stretch;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: var(--p-gap-diff-context);
  overflow-y: auto;

  /* Add these to ensure proper sizing */
  min-height: 0;
  height: 100%;
}

.section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  align-self: stretch;
  gap: var(--p-gap-same-context);
}

.items {
  align-self: stretch;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 18%));
  row-gap: 20px;
  column-gap: 40px;
}
</style>