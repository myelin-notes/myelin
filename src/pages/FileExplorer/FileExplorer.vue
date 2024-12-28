<script setup lang="ts">
import FolderItem from "./FolderItem.vue";
import FileItem from "./FileItem.vue";
import Breadcrumb from "./Breadcrumb.vue";

defineProps({
  path: Array<String>
})
</script>

<template>
  <main>
    <div id="breadcrumb" class="bubble">
      <Breadcrumb :path="path"></Breadcrumb>
    </div>
    <div id="view" class="bubble">
      <div class="section">
        <h1>Folders</h1>
        <div id="folders">
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
          <FolderItem></FolderItem>
        </div>
      </div>
      <div class="section">
        <h1>Files</h1>
        <div id="folders">
          <FileItem></FileItem>
          <FileItem></FileItem>
          <FileItem></FileItem>
          <FileItem></FileItem>
          <FileItem></FileItem>
          <FileItem></FileItem>
          <FileItem></FileItem>
        </div>
      </div>
    </div>
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

#folders {
  align-self: stretch;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 18%));
  row-gap: 20px;
  column-gap: 40px;
}
</style>