<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, useTemplateRef, watch} from "vue";
import {DrawableCanvas} from "../ts/canvas/DrawableCanvas.ts";

const canvasRef = useTemplateRef("canvas");
const zoomLevel = ref<number>(100);
const deltaTime = ref(0);
const fps = computed(() => Math.round(1 / deltaTime.value));

let drawableCanvas: DrawableCanvas | null = null;
let animationFrameId: number;
let prevTime: number = 0;

const animate = (time: number) => {
  deltaTime.value = (time - prevTime) / 1000;
  prevTime = time;
  
  drawableCanvas?.redraw(deltaTime.value);
  animationFrameId = requestAnimationFrame(animate);
};

onMounted(() => {
  if (canvasRef.value) {
    drawableCanvas = new DrawableCanvas(canvasRef.value);
    animationFrameId = requestAnimationFrame(animate);

    watch(drawableCanvas.getZoom, (newZoom) => {
      zoomLevel.value = Math.round(newZoom * 100);
    });
  }
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
});

</script>

<template>
  <div id="container">
    <canvas ref="canvas" width="600" height="600">
    </canvas>
    
    <div id="info-panel">
      <span>Zoom: {{ zoomLevel }}%</span><br>
      <span>FPS: {{ fps }}</span>
    </div>
  </div>
</template>

<style scoped>
#container {
  background-color: black;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

#container canvas {
  width: 100%;
  height: 100%;
  display: block;
}

#info-panel {
  position: absolute;
  left: 10px;
  bottom: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  color: black;
  padding: 10px;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  font-size: 14px;
  line-height: 1.5;
}
</style>