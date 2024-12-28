<script setup lang="ts">
defineProps({
  path: Array<String>
});
</script>

<template>
  <div id="breadcrumb">
    <template v-for="(p, i) in path">
      <RouterLink :to="`/file/${path?.slice(0, i + 1).join('/')}`">{{p}}</RouterLink>
      <span v-if="i != path!.length - 1"> > </span>
    </template>
  </div>
</template>

<style scoped>
#breadcrumb {
  display: flex;
  flex-direction: row;
}

#breadcrumb span {
  margin-left: 4px;
  margin-right: 4px;
}

#breadcrumb a {
  font-size: 1.15rem;
}

#breadcrumb a:hover {
  text-decoration: underline;
}
</style>