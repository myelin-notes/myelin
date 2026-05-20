import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus as PlusIcon } from 'lucide-react';
import { loadGoogleFont } from '@/components/tool-options-panel';
import {
  loadWheelToolIndices,
  saveWheelToolIndices,
} from '@/components/tool-shelf';
import type { WheelItem } from '@/components/wheel-picker';
import { useCustomColors } from '@/lib/custom-colors';
import { type Messages, useMessages } from '@/lib/i18n';
import { UserPrefs } from '@/lib/user-prefs';
import { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import {
  type ITool,
  setToolOption,
  setToolOptionValue,
  type ToolOption,
} from '@/pages/canvas/tools/tool';

function makeSizeChildren(
  tool: ITool,
  sizeOpt: Extract<ToolOption, { type: 'size' }>,
  applyRef: {
    current: (tool: ITool, option: ToolOption, value: unknown) => void;
  },
  strings: Messages,
): WheelItem[] {
  const { min, max } = sizeOpt;
  const mid = Math.round((min + max) / 2);
  return [
    {
      label: strings.canvas.toolOptions.fine(min),
      dot: 4,
      command: () => applyRef.current(tool, sizeOpt, min),
    },
    {
      label: strings.canvas.toolOptions.medium(mid),
      dot: 8,
      command: () => applyRef.current(tool, sizeOpt, mid),
    },
    {
      label: strings.canvas.toolOptions.bold(max),
      dot: 14,
      command: () => applyRef.current(tool, sizeOpt, max),
    },
  ];
}

function bindToolOption(
  tool: ITool,
  option: ToolOption,
  applyRef: {
    current: (tool: ITool, option: ToolOption, value: unknown) => void;
  },
): ToolOption {
  switch (option.type) {
    case 'color':
      return {
        ...option,
        set: (value: string) => applyRef.current(tool, option, value),
      };
    case 'size':
      return {
        ...option,
        set: (value: number) => applyRef.current(tool, option, value),
      };
    case 'font':
      return {
        ...option,
        set: (value: string) => applyRef.current(tool, option, value),
      };
    case 'choice':
      return {
        ...option,
        set: (value: string) => applyRef.current(tool, option, value),
      };
  }
}

function toolToWheelItem(
  getCanvas: () => DrawableCanvas | null,
  tool: ITool,
  toolIndex: number,
  setSelectedToolIndex: (i: number) => void,
  applyRef: {
    current: (tool: ITool, option: ToolOption, value: unknown) => void;
  },
  strings: Messages,
  customColors: string[],
  promptAddColor: () => void,
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
    const colorChildren: WheelItem[] = [
      ...colorOpt.palette,
      ...customColors,
    ].map((hex) => ({
      label: hex,
      color: hex,
      command: () => applyRef.current(tool, colorOpt, hex),
      children: sizeOpt
        ? makeSizeChildren(tool, sizeOpt, applyRef, strings)
        : undefined,
    }));
    colorChildren.push({
      label: strings.canvas.toolOptions.addCustomColor,
      icon: PlusIcon,
      command: promptAddColor,
    });
    children = colorChildren;
  } else if (sizeOpt) {
    children = makeSizeChildren(tool, sizeOpt, applyRef, strings);
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
  const strings = useMessages();
  const { colors: customColors, promptAddColor } = useCustomColors();
  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionsTick, setOptionsTick] = useState(0);
  const [shelfOpen, setShelfOpen] = useState(false);

  const [canvasTools] = useState(() => {
    const tools = DrawableCanvas.makeTools(() => strings);
    const saved = UserPrefs.get('toolOptions');
    for (const tool of tools) {
      const opts = saved[tool.id];
      if (opts) {
        for (const [key, value] of Object.entries(opts)) {
          if (!setToolOption(tool, key, value)) {
            continue;
          }
          if (key === 'fontFamily' && typeof value === 'string') {
            loadGoogleFont(value);
          }
        }
      }
    }
    return tools;
  });

  const applyOptionRef = useRef<
    (tool: ITool, option: ToolOption, value: unknown) => void
  >(() => {});
  applyOptionRef.current = (
    tool: ITool,
    option: ToolOption,
    value: unknown,
  ) => {
    if (!setToolOptionValue(option, value)) {
      return;
    }
    const canvas = drawableCanvasRef.current;
    if (canvas) {
      tool.applyOptionToSelection?.(canvas, option.key, value);
    }
    setOptionsTick((t) => t + 1);
    UserPrefs.update('toolOptions', (all) => ({
      ...all,
      [tool.id]: { ...all[tool.id], [option.key]: value },
    }));
  };

  const allWheelItems = useMemo(
    () =>
      canvasTools.map((tool, index) =>
        toolToWheelItem(
          () => drawableCanvasRef.current,
          tool,
          index,
          setSelectedToolIndex,
          applyOptionRef,
          strings,
          customColors,
          promptAddColor,
        ),
      ),
    [canvasTools, customColors, drawableCanvasRef, promptAddColor, strings],
  );

  const [wheelEnabledIndices, setWheelEnabledIndices] = useState<Set<number>>(
    () => loadWheelToolIndices(canvasTools.length),
  );

  const wheelItems = useMemo(
    () => allWheelItems.filter((_, i) => wheelEnabledIndices.has(i)),
    [allWheelItems, wheelEnabledIndices],
  );

  // Hide options when switching tools
  useEffect(() => {
    setOptionsVisible(false);
  }, []);

  const tool = canvasTools[selectedToolIndex];
  const activeOptions = useMemo(() => {
    void optionsTick;
    return tool
      ? (tool.getOptions?.() ?? []).map((option) =>
          bindToolOption(tool, option, applyOptionRef),
        )
      : [];
  }, [optionsTick, tool]);

  const hasOptions = activeOptions.length > 0;

  const handleToggleWheelTool = useCallback((index: number) => {
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
  }, []);

  const selectTool = useCallback(
    (index: number) => {
      drawableCanvasRef.current?.switchTool(index);
      setSelectedToolIndex(index);
      setShelfOpen(false);
      const toolHasOptions =
        (canvasTools[index]?.getOptions?.()?.length ?? 0) > 0;
      setOptionsVisible(toolHasOptions);
    },
    [canvasTools, drawableCanvasRef],
  );

  const toggleOptions = useCallback(() => {
    setOptionsVisible((v) => !v);
    setShelfOpen(false);
  }, []);

  const hideOptions = useCallback(() => {
    setOptionsVisible(false);
  }, []);

  const toggleShelf = useCallback(() => {
    setShelfOpen((v) => !v);
    setOptionsVisible(false);
  }, []);

  const closeShelf = useCallback(() => {
    setShelfOpen(false);
  }, []);

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
    hideOptions,
    wheelItems,
    wheelEnabledIndices,
    handleToggleWheelTool,
  };
}
