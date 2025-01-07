<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, useTemplateRef, watch, reactive} from "vue";
import {DrawableCanvas} from "../ts/canvas/DrawableCanvas.ts";
import {SpeedDial} from "primevue";
import {MenuItem} from "primevue/menuitem";
import {ITool} from "../ts/canvas/tools/Tools.ts";

const canvasRef = useTemplateRef("canvas");
const zoomLevel = ref<number>(100);
const deltaTime = ref(0);
const fps = computed(() => Math.round(1 / deltaTime.value));
const props = defineProps<{
  path: string[]
}>();

let drawableCanvas: DrawableCanvas | null = null;
let animationFrameId: number;
let prevTime: number = 0;

const tools = DrawableCanvas.makeTools().map((value, index, _arr) => toolToMenuitem(() => drawableCanvas!, value, index));
const toolsVisible = ref(true);
const toolsContentVisible = ref(false);
const toolsStyle = reactive({ position: "absolute", left: "-100px", top: "-100px", transform: "translate(-50%, -50%)" });

function animate(time: number) {
  deltaTime.value = (time - prevTime) / 1000;
  prevTime = time;
  
  drawableCanvas?.redraw(deltaTime.value);
  animationFrameId = requestAnimationFrame(animate);
}

function toolToMenuitem(canvas: () => DrawableCanvas, tool: ITool, index: number): MenuItem {
  return {
    label: tool.label,
    icon: tool.icon,
    command: (_event) => canvas().switchTool(index),
  }
}

function hideTools(evt: PointerEvent) {
  if (evt.pointerType != "mouse" && evt.pointerType != "pen") return;
  toolsContentVisible.value = false;
  setTimeout(() => toolsVisible.value = false, 100);
}

onMounted(() => {
  if (canvasRef.value) {
    canvasRef.value.addEventListener("contextmenu", evt => {
      if (evt.shiftKey) {
        return;
      }
      evt.preventDefault();
    });

    canvasRef.value.addEventListener("pointerdown", evt => {
      if (evt.pointerType === "mouse") {
        if (toolsVisible.value && toolsStyle.left != "-100px" && toolsStyle.top != "-100px") {
          hideTools(evt);
          return;
        }
        
        if (evt.button === 2) {
          toolsStyle.left = `${evt.pageX}px`;
          toolsStyle.top = `${evt.pageY}px`;
          toolsVisible.value = true;
          toolsContentVisible.value = false;
          setTimeout(() => toolsContentVisible.value = true, 100);
        }
      }
    })
    
    canvasRef.value.addEventListener("pointerup", hideTools);
    
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

    <transition name="fade">
      <div v-if="toolsVisible">
        <SpeedDial
            :model="tools"
            :style="toolsStyle"
            :visible="toolsContentVisible"
            :radius="120"
            :hide-on-click-outside="false"
            :transition-delay="10"
            direction="up-left"
            type="circle"
            @contextmenu.prevent
            @pointerup="hideTools"
        >
<!--          <template #item="{ item }">-->
<!--            <Button-->
<!--                :tabindex="-1"-->
<!--                role="menuitem"-->
<!--                :aria-label="item.label"-->
<!--            >-->
<!--              <template v-if="item.icon" #icon="slotProps">-->
<!--                <slot name="itemicon" :item="item" :class="slotProps.class">-->
<!--                  <span :class="[item.icon, slotProps.class]" v-bind="getPTOptions(`${id}_${index}`, 'actionIcon')"></span>-->
<!--                </slot>-->
<!--              </template>-->
<!--            </Button>-->
<!--          </template>-->
        </SpeedDial>
      </div>
    </transition>
  </div>
</template>

<style scoped>
#container {
  background-color: black;
  width: 100%;
  height: 100%;
  overflow: hidden;
  margin: 0;
  padding: 0;
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

.fade-enter-active, .fade-leave-active {
  transition: opacity 200ms;
}

.fade-enter, .fade-leave-to {
  opacity: 0;
}

</style>