<script setup lang="ts">
import {EditableDocument} from "../../ts/document/EditableDocument.ts";
import {BaseDirectory, readFile} from "@tauri-apps/plugin-fs";

const props = defineProps<{ path: string[] }>();
const document = new EditableDocument((await readFile(props.path.join("/"), {baseDir: BaseDirectory.AppData})).buffer);
</script>

<template>
  {{ path.join("/") }}
</template>

<style scoped>
</style>