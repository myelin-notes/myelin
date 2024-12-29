<script setup lang="ts">
import FolderItem from "./FolderItem.vue";
import FileItem from "./FileItem.vue";
import {MyelinFile} from "../../ts/utils/FileSystem.ts";
import {computed, ref} from "vue";
import {ContextMenu, useConfirm, ConfirmDialog} from "primevue";
import {MenuItem} from "primevue/menuitem";

const props = defineProps<{
  path: string[],
  directories: string[],
  files: MyelinFile[]
}>();

const menu = ref();
const confirm = useConfirm();
const selectedItem = ref<null | string>(null);

const slash = computed(() => props.path.length === 1 ? '' : '/');
const items: MenuItem[] = [
  {
    label: 'Rename',
    icon: 'pi pi-pen-to-square',
    command: () => {
      confirm.require({
        message: 'Do you want to delete this record?',
        header: 'Danger Zone',
        icon: 'pi pi-info-circle',
        rejectLabel: 'Cancel',
        rejectProps: {
          label: 'Cancel',
          severity: 'secondary',
          outlined: true
        },
        acceptProps: {
          label: 'Delete',
          severity: 'danger'
        },
        accept: () => {
        },
        reject: () => {
        }        
      })
    },
  },
  {
    label: 'Delete',
    icon: 'pi pi-trash',
    command: () => {
    }
  },
];

function openCtx(event: PointerEvent, item: string) {
  selectedItem.value = item;
  console.log(item);
  menu.value.show(event);
}
</script>

<template>
  <div id="view" class="bubble">
    <div class="section">
      <h1>Folders</h1>
      <div v-if="directories.length > 0" class="items">
        <template v-for="dir in directories">
          <FolderItem
              :title="dir"
              :link="path.join('/') + `/${dir}`"
              :open-ctx/>
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
              :link="path.join('/') + `${slash}${file.name}.${file.type}`"
              :open-ctx/>
        </template>
      </div>
      <div v-else>
        <h2>Create a new file</h2>
      </div>
    </div>
    <ContextMenu ref="menu" :model="items"/>
    <ConfirmDialog/>
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