<script setup lang="ts">
import {onMounted, onUnmounted, onUpdated, useTemplateRef} from "vue";
import {DrawableCanvas} from "../ts/canvas/DrawableCanvas.ts";

const canvasRef = useTemplateRef("canvas");
let drawableCanvas: DrawableCanvas | null = null;
let animationFrameId: number;

const animate = () => {
  drawableCanvas?.redraw();
  animationFrameId = requestAnimationFrame(animate);
};

onMounted(() => {
  if (canvasRef.value) {
    drawableCanvas = new DrawableCanvas(canvasRef.value);
    animationFrameId = requestAnimationFrame(animate);
  }
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
});

</script>

<template>
  <div id="container">
    <canvas ref="canvas" width="400" height="400"></canvas>
  </div>
</template>

<style scoped>
#container {
  background-color: black;
  width: 100%;
  height: 100%;
}
</style>