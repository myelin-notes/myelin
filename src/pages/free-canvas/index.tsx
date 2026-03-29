import { useRef } from "react";
import { useParams } from "react-router-dom";
import { DrawableCanvas } from "@/pages/free-canvas/drawable-canvas";
import { WheelPicker, WheelPickerHandle } from "@/components/wheel-picker";
import { X as XIcon } from "lucide-react";
import { useToolState } from "./hooks/use-tool-state";
import { useCanvasEngine } from "./hooks/use-canvas-engine";
import { TitleBar } from "./components/title-bar";
import { CanvasToolbar } from "./components/canvas-toolbar";
import { TextEditOverlay } from "./components/text-edit-overlay";
import { PageFrameDomLayer } from "./components/page-frame-dom-layer";
import { StatusBar } from "./components/status-bar";

export function CanvasView() {
  const { id } = useParams<{ id: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const toolState = useToolState(drawableCanvasRef);
  const engine = useCanvasEngine({
    id,
    canvasRef,
    wheelRef,
    drawableCanvasRef,
    canvasTools: toolState.canvasTools,
    setSelectedToolIndex: toolState.setSelectedToolIndex,
  });

  return (
    <div className="bg-page w-full h-full overflow-hidden relative">
      <TitleBar fileName={engine.fileName} onBack={engine.back} />

      <CanvasToolbar
        tools={toolState.canvasTools}
        selectedToolIndex={toolState.selectedToolIndex}
        optionsVisible={toolState.optionsVisible}
        shelfOpen={toolState.shelfOpen}
        activeOptions={toolState.activeOptions}
        hasOptions={toolState.hasOptions}
        wheelEnabledIndices={toolState.wheelEnabledIndices}
        onSelectTool={toolState.selectTool}
        onToggleOptions={toolState.toggleOptions}
        onSetOption={toolState.handleSetOption}
        onToggleShelf={toolState.toggleShelf}
        onCloseShelf={toolState.closeShelf}
        onToggleWheelTool={toolState.handleToggleWheelTool}
      />

      {/* z:0 — Background (dot grid is drawn on the canvas layer since it follows zoom/pan) */}
      <div
        className="absolute inset-0 bg-page"
        style={{ zIndex: 0 }}
      />

      {/* z:1 — DOM layer for page frame chrome + text */}
      <PageFrameDomLayer
        canvasRef={engine.drawableCanvasRef}
        editingElement={engine.editingPageFrame}
        onCommitEdit={engine.commitPageFrameEdit}
      />

      {/* z:5 — Transparent canvas for strokes, images, selection */}
      <canvas ref={canvasRef} className="w-full h-full block absolute inset-0" style={{ zIndex: 5 }} />

      <input
        ref={engine.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={engine.handleFileInputChange}
      />

      <StatusBar zoomLevel={engine.zoomLevel} fps={engine.fps} />

      {engine.textEdit && (
        <TextEditOverlay
          textEdit={engine.textEdit}
          onDismiss={() => engine.setTextEdit(null)}
        />
      )}

      <div style={{ zIndex: 20 }} className="absolute inset-0 pointer-events-none [&>*]:pointer-events-auto">
        <WheelPicker ref={wheelRef} radius={100} items={toolState.wheelItems}>
          <XIcon className="size-4 text-white" />
        </WheelPicker>
      </div>
    </div>
  );
}
