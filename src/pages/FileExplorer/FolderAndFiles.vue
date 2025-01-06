<script setup lang="ts">
import FolderItem from "./FolderItem.vue";
import FileItem from "./FileItem.vue";
import {FileSystem, MyelinFile} from "../../ts/utils/FileSystem.ts";
import {ref} from "vue";
import {ConfirmDialog, ContextMenu, Dialog, InputText, useConfirm, useToast} from "primevue";
import {MenuItem} from "primevue/menuitem";
import {basename, extname} from "@tauri-apps/api/path";
import {BaseDirectory, stat} from '@tauri-apps/plugin-fs';

const emit = defineEmits(["reload"]);
defineProps<{
  path: string[],
  directories: string[],
  files: MyelinFile[]
}>();

const menu = ref();
const selectedItem = ref<null | string>(null);
const renameDialogOpen = ref(false);
const renameName = ref<null | string>(null);

const confirm = useConfirm();
const toast = useToast();

const items: MenuItem[] = [
  {
    label: 'Rename',
    icon: 'pi pi-pen-to-square',
    command: async () => {
      const path = selectedItem.value!;
      const isFile = (await stat(path, { baseDir: BaseDirectory.AppData })).isFile;
      
      if (isFile) {
        let name = await basename(path, await extname(path));
        name = name.slice(0, name.length - 1);
        renameName.value = name;
      } else {
        renameName.value = await basename(path);
      }
      
      renameDialogOpen.value = true;
    }
  },
  {
    label: 'Delete',
    icon: 'pi pi-trash',
    command: () => {
      confirm.require({
        header: 'Do you want to delete this?',
        message: 'This can not be undone!',
        rejectLabel: 'Cancel',
        rejectProps: {
          label: 'Cancel',
          severity: 'secondary',
        },
        acceptProps: {
          label: 'Delete',
          severity: 'danger'
        },
        accept: async () => {
          await FileSystem.deleteFileOrFolder(selectedItem.value!);
          emit('reload');
        },
      });
    }
  },
];

function openCtx(event: PointerEvent, item: string) {
  selectedItem.value = item;
  console.log(selectedItem.value);
  menu.value.show(event);
}

async function rename() {
  await FileSystem.renameFileOrFolder(selectedItem.value!, renameName.value!);
  emit('reload');
  toast.add({
    severity: "success",
    summary: "Renamed successfully",
    detail: `Renamed to ${renameName.value}`,
    life: 4000,
  });
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
              :link="path.join('/') + `/${file.name}.${file.type}`"
              :open-ctx/>
        </template>
      </div>
      <div v-else>
        <h2>Create a new file</h2>
      </div>
    </div>
    <ContextMenu ref="menu" :model="items"/>
    <ConfirmDialog/>
    
    <Dialog modal v-model:visible="renameDialogOpen">
      <template #container="{ closeCallback }">
        <div class="dialog bubble">
          <h1>Rename Folder</h1>
          <InputText autofocus placeholder="Folder Name" v-model="renameName"/>
          <div class="dialog-buttons">
            <button class="btn" @click="closeCallback()">
              <span>Cancel</span>
            </button>
            <button class="btn" @click="closeCallback();rename();">
              <span>Confirm</span>
            </button>
          </div>
        </div>
      </template>
    </Dialog>
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