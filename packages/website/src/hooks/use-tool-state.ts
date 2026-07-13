import { useCallback, useMemo, useRef, useState } from 'react';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import {
  type ITool,
  setToolOption,
  setToolOptionValue,
  type ToolOption,
} from '@myelin/editor/tools/tool';
import { useMessages } from '@/lib/i18n';
import { UserPrefs } from '@/lib/user-prefs';

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

export function useToolState(
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>,
) {
  const strings = useMessages();
  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionsTick, setOptionsTick] = useState(0);

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
            ensureDisplayFont(value);
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

  const tool = canvasTools[selectedToolIndex];
  // biome-ignore lint/correctness/useExhaustiveDependencies: optionsTick forces recompute when a tool option mutates in place
  const activeOptions = useMemo(
    () =>
      tool
        ? (tool.getOptions?.() ?? []).map((option) =>
            bindToolOption(tool, option, applyOptionRef),
          )
        : [],
    [optionsTick, tool],
  );

  const hasOptions = activeOptions.length > 0;

  const selectTool = useCallback(
    (index: number) => {
      drawableCanvasRef.current?.switchTool(index);
      const toolHasOptions =
        (canvasTools[index]?.getOptions?.()?.length ?? 0) > 0;
      setOptionsVisible(toolHasOptions);
    },
    [canvasTools, drawableCanvasRef],
  );

  const toggleOptions = useCallback(() => {
    setOptionsVisible((v) => !v);
  }, []);

  const hideOptions = useCallback(() => {
    setOptionsVisible(false);
  }, []);

  return {
    canvasTools,
    selectedToolIndex,
    setSelectedToolIndex,
    selectTool,
    toggleOptions,
    optionsVisible,
    activeOptions,
    hasOptions,
    hideOptions,
  };
}
