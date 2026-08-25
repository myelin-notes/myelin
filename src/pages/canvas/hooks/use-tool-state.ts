import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus as PlusIcon } from 'lucide-react';
import { makePenPresetMarkIcon } from '@myelin/editor/components/pen-preset-mark';
import { useCustomColors } from '@myelin/editor/custom-colors';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import { type Messages, useMessages } from '@myelin/editor/i18n';
import { getPenPresetLabel, usePenPresets } from '@myelin/editor/pen-presets';
import {
  MAX_CUSTOM_COLORS,
  MAX_PEN_PRESETS,
} from '@myelin/editor/sync/repo/config';
import type {
  CustomColorTool,
  PenPreset,
  PenPresetTool,
} from '@myelin/editor/sync/repo/types';
import {
  type ITool,
  setToolOption,
  setToolOptionValue,
  type ToolOption,
} from '@myelin/editor/tools/tool';
import { UserPrefs } from '@myelin/editor/user-prefs';
import {
  loadWheelToolIndices,
  MAX_WHEEL_ENTRIES,
  saveWheelToolIndices,
} from '@/components/tool-shelf';
import type { WheelItem } from '@/components/wheel-picker';

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
  applyRef: {
    current: (tool: ITool, option: ToolOption, value: unknown) => void;
  },
  strings: Messages,
  customColors: Record<CustomColorTool, string[]>,
  promptAddColor: (tool: CustomColorTool) => void,
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
    const customColorTool = getCustomColorTool(tool);
    const colorChildren: WheelItem[] = [
      ...colorOpt.palette,
      ...(customColorTool ? customColors[customColorTool] : []),
    ].map((hex) => ({
      label: hex,
      color: hex,
      command: () => applyRef.current(tool, colorOpt, hex),
      children: sizeOpt
        ? makeSizeChildren(tool, sizeOpt, applyRef, strings)
        : undefined,
    }));
    if (
      customColorTool &&
      customColors[customColorTool].length < MAX_CUSTOM_COLORS
    ) {
      colorChildren.push({
        label: strings.canvas.toolOptions.addCustomColor,
        icon: PlusIcon,
        command: () => promptAddColor(customColorTool),
      });
    }
    children = colorChildren;
  } else if (sizeOpt) {
    children = makeSizeChildren(tool, sizeOpt, applyRef, strings);
  }

  return {
    label: tool.label,
    icon: tool.icon,
    command: () => getCanvas()?.switchTool(toolIndex),
    children,
  };
}

function getPenPresetTool(tool: ITool | undefined): PenPresetTool | null {
  switch (tool?.id) {
    case 'pen':
    case 'highlighter':
      return tool.id;
    default:
      return null;
  }
}

/** A pen or highlighter's live colour and stroke — the triple a preset is cut from. */
function readPenSettings(
  tool: ITool | undefined,
): { color: string; size: number } | null {
  const options = tool?.getOptions?.() ?? [];
  const color = options.find((o) => o.type === 'color')?.value;
  const size = options.find((o) => o.type === 'size')?.value;
  if (typeof color !== 'string' || typeof size !== 'number') {
    return null;
  }
  return { color, size };
}

function getCustomColorTool(tool: ITool): CustomColorTool | null {
  switch (tool.id) {
    case 'pen':
    case 'highlighter':
    case 'text':
      return tool.id;
    default:
      return null;
  }
}

export function useToolState(
  drawableCanvasRef: React.RefObject<DrawableCanvas | null>,
) {
  const strings = useMessages();
  const penColors = useCustomColors('pen');
  const highlighterColors = useCustomColors('highlighter');
  const textColors = useCustomColors('text');
  const customColors = useMemo(
    () => ({
      pen: penColors.colors,
      highlighter: highlighterColors.colors,
      text: textColors.colors,
    }),
    [highlighterColors.colors, penColors.colors, textColors.colors],
  );
  const promptAddColor = useCallback(
    (tool: CustomColorTool) => {
      switch (tool) {
        case 'pen':
          penColors.promptAddColor();
          return;
        case 'highlighter':
          highlighterColors.promptAddColor();
          return;
        case 'text':
          textColors.promptAddColor();
      }
    },
    [
      highlighterColors.promptAddColor,
      penColors.promptAddColor,
      textColors.promptAddColor,
    ],
  );
  const { presets, canAddPreset, addPreset, updatePreset, removePreset } =
    usePenPresets();
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

  const allWheelItems = useMemo(
    () =>
      canvasTools.map((tool, index) =>
        toolToWheelItem(
          () => drawableCanvasRef.current,
          tool,
          index,
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

  const applyPreset = useCallback(
    (preset: PenPreset) => {
      const index = canvasTools.findIndex((tool) => tool.id === preset.tool);
      const target = canvasTools[index];
      if (!target) {
        return;
      }
      const options = target.getOptions?.() ?? [];
      const sizeOpt = options.find((o) => o.type === 'size');
      const colorOpt = options.find((o) => o.type === 'color');
      // Options before the switch, the order the wheel commits its own path in.
      if (sizeOpt) {
        applyOptionRef.current(target, sizeOpt, preset.size);
      }
      if (colorOpt) {
        applyOptionRef.current(target, colorOpt, preset.color);
      }
      drawableCanvasRef.current?.switchTool(index);
    },
    [canvasTools, drawableCanvasRef],
  );

  const wheelPresets = useMemo(
    () => presets.filter((preset) => preset.inWheel),
    [presets],
  );

  // Presets take the trailing arc, so adding one never moves a tool's angle.
  const wheelItems = useMemo(
    () => [
      ...allWheelItems.filter((_, i) => wheelEnabledIndices.has(i)),
      ...wheelPresets.map((preset) => ({
        label: getPenPresetLabel(preset, strings),
        icon: makePenPresetMarkIcon(preset),
        command: () => applyPreset(preset),
      })),
    ],
    [allWheelItems, applyPreset, strings, wheelEnabledIndices, wheelPresets],
  );

  const wheelFull =
    wheelEnabledIndices.size + wheelPresets.length >= MAX_WHEEL_ENTRIES;

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

  const handleToggleWheelTool = useCallback(
    (index: number) => {
      setWheelEnabledIndices((prev) => {
        if (!prev.has(index) && wheelFull) {
          return prev;
        }
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        saveWheelToolIndices(next);
        return next;
      });
    },
    [wheelFull],
  );

  const activePenTool = getPenPresetTool(canvasTools[selectedToolIndex]);

  // A preset is highlighted while the live tool still holds its exact triple, so applying one shows
  // immediately and any later drift drops the highlight on its own. Nothing is stored.
  // biome-ignore lint/correctness/useExhaustiveDependencies: optionsTick forces recompute when a tool option mutates in place
  const matchedPresetId = useMemo(() => {
    const settings = readPenSettings(canvasTools[selectedToolIndex]);
    if (!activePenTool || !settings) {
      return null;
    }
    return (
      presets.find(
        (preset) =>
          preset.tool === activePenTool &&
          preset.size === settings.size &&
          preset.color.toLowerCase() === settings.color.toLowerCase(),
      )?.id ?? null
    );
  }, [activePenTool, canvasTools, optionsTick, presets, selectedToolIndex]);

  const savePresetDisabledReason = !activePenTool
    ? strings.canvas.toolPresets.saveNeedsPen
    : canAddPreset
      ? null
      : strings.canvas.toolPresets.saveFull(MAX_PEN_PRESETS);

  const saveCurrentAsPreset = useCallback(() => {
    const settings = readPenSettings(canvasTools[selectedToolIndex]);
    if (!activePenTool || !settings || !canAddPreset) {
      return;
    }
    // An exact duplicate is a no-op in the repository, so this can't stack.
    void addPreset({ tool: activePenTool, ...settings, inWheel: !wheelFull });
  }, [
    activePenTool,
    addPreset,
    canAddPreset,
    canvasTools,
    selectedToolIndex,
    wheelFull,
  ]);

  const updatePresetToCurrent = useCallback(
    (preset: PenPreset) => {
      const settings = readPenSettings(canvasTools[selectedToolIndex]);
      if (!settings) {
        return;
      }
      void updatePreset(preset.id, settings);
    },
    [canvasTools, selectedToolIndex, updatePreset],
  );

  const togglePresetInWheel = useCallback(
    (preset: PenPreset) => {
      if (!preset.inWheel && wheelFull) {
        return;
      }
      void updatePreset(preset.id, { inWheel: !preset.inWheel });
    },
    [updatePreset, wheelFull],
  );

  const deletePreset = useCallback(
    (preset: PenPreset) => {
      void removePreset(preset.id);
    },
    [removePreset],
  );

  const selectTool = useCallback(
    (index: number) => {
      drawableCanvasRef.current?.switchTool(index);
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
    presets,
    matchedPresetId,
    activePenTool,
    wheelFull,
    savePresetDisabledReason,
    applyPreset,
    saveCurrentAsPreset,
    updatePresetToCurrent,
    togglePresetInWheel,
    deletePreset,
  };
}
