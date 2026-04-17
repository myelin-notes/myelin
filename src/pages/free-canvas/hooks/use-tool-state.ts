import { useEffect, useRef, useState } from 'react';
import { loadGoogleFont } from '@/components/tool-options-panel';
import {
  loadWheelToolIndices,
  saveWheelToolIndices,
} from '@/components/tool-shelf';
import type { WheelItem } from '@/components/wheel-picker';
import { UserPrefs } from '@/lib/user-prefs';
import { DrawableCanvas } from '@/pages/free-canvas/drawable-canvas';
import type { ITool, ToolOption } from '@/pages/free-canvas/tools/tool';

function makeSizeChildren(
  tool: ITool,
  sizeOpt: Extract<ToolOption, { type: 'size' }>,
  applyRef: { current: (tool: ITool, key: string, value: unknown) => void },
): WheelItem[] {
  const { min, max, key } = sizeOpt;
  const mid = Math.round((min + max) / 2);
  return [
    {
      label: `Fine (${min})`,
      dot: 4,
      command: () => applyRef.current(tool, key, min),
    },
    {
      label: `Medium (${mid})`,
      dot: 8,
      command: () => applyRef.current(tool, key, mid),
    },
    {
      label: `Bold (${max})`,
      dot: 14,
      command: () => applyRef.current(tool, key, max),
    },
  ];
}

function toolToWheelItem(
  getCanvas: () => DrawableCanvas | null,
  tool: ITool,
  toolIndex: number,
  setSelectedToolIndex: (i: number) => void,
  applyRef: { current: (tool: ITool, key: string, value: unknown) => void },
): WheelItem {
  const options = tool.getOptions?.() ?? [];
  const colorOpt = options.find(
    (o): o is Extract<ToolOption, { type: 'color' }> => o.type === 'color',
  );
  const sizeOpt = options.find(
    (o): o is Extract<ToolOption, { type: 'size' }> => o.type === 'size',
  );

  let children: WheelItem[] | undefined;

  if (colorOpt) {
    children = colorOpt.palette.map((hex) => ({
      label: hex,
      color: hex,
      command: () => applyRef.current(tool, colorOpt.key, hex),
      children: sizeOpt ? makeSizeChildren(tool, sizeOpt, applyRef) : undefined,
    }));
  } else if (sizeOpt) {
    children = makeSizeChildren(tool, sizeOpt, applyRef);
  }

  return {
    label: tool.label,
    icon: tool.icon,
    command: () => {
      getCanvas()?.switchTool(toolIndex);
      setSelectedToolIndex(toolIndex);
    },
    children,
  };
}

export function useToolState(
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>,
) {
  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionsTick, setOptionsTick] = useState(0);
  const [shelfOpen, setShelfOpen] = useState(false);

  const [canvasTools] = useState(() => {
    const tools = DrawableCanvas.makeTools();
    const saved = UserPrefs.get('toolOptions');
    for (const tool of tools) {
      const opts = saved[tool.label];
      if (opts && tool.setOption) {
        for (const [key, value] of Object.entries(opts)) {
          tool.setOption(key, value);
          if (key === 'fontFamily' && typeof value === 'string') {
            loadGoogleFont(value);
          }
        }
      }
    }
    return tools;
  });

  const applyOptionRef = useRef<
    (tool: ITool, key: string, value: unknown) => void
  >(() => {});
  applyOptionRef.current = (tool: ITool, key: string, value: unknown) => {
    tool.setOption?.(key, value);
    const canvas = drawableCanvasRef.current;
    if (canvas) {
      tool.applyOptionToSelection?.(canvas, key, value);
    }
    setOptionsTick((t) => t + 1);
    UserPrefs.update('toolOptions', (all) => ({
      ...all,
      [tool.label]: { ...all[tool.label], [key]: value },
    }));
  };

  const [allWheelItems] = useState<WheelItem[]>(() =>
    canvasTools.map((tool, index) =>
      toolToWheelItem(
        () => drawableCanvasRef.current,
        tool,
        index,
        setSelectedToolIndex,
        applyOptionRef,
      ),
    ),
  );

  const [wheelEnabledIndices, setWheelEnabledIndices] = useState<Set<number>>(
    () => loadWheelToolIndices(canvasTools.length),
  );

  const wheelItems = allWheelItems.filter((_, i) => wheelEnabledIndices.has(i));

  // Hide options when switching tools
  useEffect(() => {
    setOptionsVisible(false);
  }, []);

  void optionsTick;
  const tool = canvasTools[selectedToolIndex];
  const activeOptions = tool?.getOptions?.() ?? [];

  const hasOptions = activeOptions.length > 0;

  const handleSetOption = (key: string, value: unknown) => {
    const tool = canvasTools[selectedToolIndex];
    if (tool?.setOption) {
      tool.setOption(key, value);
      const canvas = drawableCanvasRef.current;
      if (canvas) {
        tool.applyOptionToSelection?.(canvas, key, value);
      }
      setOptionsTick((t) => t + 1);
      UserPrefs.update('toolOptions', (all) => {
        const opts = { ...all[tool.label], [key]: value };
        return { ...all, [tool.label]: opts };
      });
    }
  };

  const handleToggleWheelTool = (index: number) => {
    setWheelEnabledIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      saveWheelToolIndices(next);
      return next;
    });
  };

  const selectTool = (index: number) => {
    drawableCanvasRef.current?.switchTool(index);
    setSelectedToolIndex(index);
    setShelfOpen(false);
    const toolHasOptions =
      (canvasTools[index]?.getOptions?.()?.length ?? 0) > 0;
    setOptionsVisible(toolHasOptions);
  };

  const toggleOptions = () => {
    setOptionsVisible((v) => !v);
    setShelfOpen(false);
  };

  const hideOptions = () => {
    setOptionsVisible(false);
  };

  const toggleShelf = () => {
    setShelfOpen((v) => !v);
    setOptionsVisible(false);
  };

  const closeShelf = () => {
    setShelfOpen(false);
  };

  return {
    canvasTools,
    selectedToolIndex,
    setSelectedToolIndex,
    selectTool,
    toggleOptions,
    toggleShelf,
    closeShelf,
    optionsVisible,
    shelfOpen,
    activeOptions,
    hasOptions,
    handleSetOption,
    hideOptions,
    wheelItems,
    wheelEnabledIndices,
    handleToggleWheelTool,
  };
}
