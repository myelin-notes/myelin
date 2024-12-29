<script setup lang="ts">
import Breadcrumb from "./Breadcrumb.vue";
import FolderAndFiles from "./FolderAndFiles.vue";
import {Dialog, Divider, InputText, Popover} from "primevue";

import {FileSystem} from "../../ts/utils/FileSystem.ts";
import {ref, watch} from "vue";
import {BaseDirectory, mkdir} from "@tauri-apps/plugin-fs";

const props = defineProps<{ path: string[], }>();
const entries = ref(await FileSystem.load(props.path));
const createFolderName = ref("Unnamed Folder");

let dialogOpen = ref(false);
let popover = ref();

watch(() => props.path, async (newProp, _prevProp) => {
  entries.value = await FileSystem.load(newProp);
});

function openCreateNewFile(event: MouseEvent) {
  popover.value.toggle(event);
}

async function createFolder() {
  await mkdir(`${props.path.join("/")}/${createFolderName.value}`, {baseDir: BaseDirectory.AppData});
  entries.value = await FileSystem.load(props.path);
}
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
        <Popover ref="popover">
          <button class="btn" @click="dialogOpen = true;popover=false;popover.hide();">
            <span class="icon pi pi-folder-plus"/>
            <span>New Folder</span>
          </button>

          <Divider/>

          <button class="btn">
            <span class="icon pi pi-file-import"/>
            <span>Import Myelin File</span>
          </button>

          <button class="btn">
            <span class="icon pi pi-file-pdf"/>
            <span>Import PDF</span>
          </button>

          <Divider/>

          <button class="btn">
            <span class="icon pi pi-file-plus"/>
            <span>New Document</span>
          </button>

          <button class="btn">
            <svg class="icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="18px"
                 fill="currentColor">
              <path
                  d="M280-280h84l240-238-86-86-238 238v86Zm352-266 42-44q6-6 6-14t-6-14l-56-56q-6-6-14-6t-14 6l-44 42 86 86ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h168q13-36 43.5-58t68.5-22q38 0 68.5 22t43.5 58h168q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm280-590q13 0 21.5-8.5T510-820q0-13-8.5-21.5T480-850q-13 0-21.5 8.5T450-820q0 13 8.5 21.5T480-790ZM200-200v-560 560Z"/>
            </svg>
            <span>New Canvas</span>
          </button>
        </Popover>
        <button id="create" class="foreground-item" @click="openCreateNewFile($event)">
          <span class="icon pi pi-pencil"/>
        </button>
      </div>
    </div>
    <FolderAndFiles
        :directories="entries[0]"
        :files="entries[1]"
        :path="props.path"/>
  </main>

  <Dialog modal v-model:visible="dialogOpen">
    <template #container="{ closeCallback }">
      <div id="dialog" class="bubble">
        <h1>Create Folder</h1>
        <InputText placeholder="Folder Name" v-model="createFolderName"/>
        <div id="dialog-buttons">
          <button class="btn" @click="closeCallback()">
            <span>Cancel</span>
          </button>
          <button class="btn" @click="closeCallback();createFolder();">
            <span>Confirm</span>
          </button>
        </div>
      </div>
    </template>
  </Dialog>
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

#dialog {
  display: flex;
  flex-direction: column;
  gap: var(--p-gap-same-context);
}

#dialog-buttons {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
}

#dialog-buttons * {
  border-radius: var(--p-border-radius);
}

.btn {
  background-color: transparent;
  padding: 8px 16px;
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  gap: var(--p-gap-same-context);
  width: 100%;
}

.btn:hover {
  background-color: var(--c-secondary);
}

.btn .icon {
  color: var(--c-primary);
}

.btn:hover .icon {
  color: var(--c-icons);
}
</style>