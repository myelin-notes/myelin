<script setup lang="ts">
import {onMounted, onUnmounted, useTemplateRef} from "vue";
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
    <canvas ref="canvas" width="600" height="600">
    </canvas>
    
<!--    <div id="info-panel">-->
<!--    </div>-->
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
  top: 10px;
  right: 10px;
  background-color: rgba(255, 255, 255, 0.8);
  color: black;
  padding: 10px;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  font-size: 14px;
  line-height: 1.5;
}
</style>