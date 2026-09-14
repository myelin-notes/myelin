import { describe, expect, it, vi } from 'vitest';
import { CanvasElementFactory } from './canvas-element-factory';
import type { CanvasElementContext } from './elements/canvas-element-context';
import { DrawableElement } from './elements/drawable-element';
import { ElementType } from './elements/element-type';
import { YDocManager } from './ydoc-manager';

class ConfigurableElement extends DrawableElement {
  public configuredWith: CanvasElementContext | null = null;
  public disposed = false;

  public constructor(uuid: string) {
    super(uuid, ElementType.SHAPE);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {};
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, 0, 0);
  }

  protected isOverLocal(): boolean {
    return false;
  }

  protected updateBoundingBox(): void {}

  protected draw2D(): void {}

  public override configureCanvas(context: CanvasElementContext): void {
    this.configuredWith = context;
  }

  public override disposeCanvas(): void {
    this.disposed = true;
  }
}

describe('CanvasElementFactory', () => {
  it('configures and disposes elements through their lifecycle hooks', () => {
    const ydoc = new YDocManager();
    const element = new ConfigurableElement('custom-element');
    const elements = [element];
    const onChange = vi.fn();
    const uiServices = {
      openChromeMenu: vi.fn(),
      openExportDialog: vi.fn(),
    };
    const factory = new CanvasElementFactory({
      ydoc,
      getElements: () => elements,
      onChange,
      invalidateContentBounds: vi.fn(),
      localPeerId: 'peer-1',
      audioRecordingOwnerId: 'owner-1',
      uiServices,
    });
    const yMap = ydoc.createElementMap(ElementType.SHAPE, element.uuid, {});

    factory.initialize(element, yMap);

    expect(element.configuredWith).toMatchObject({
      localPeerId: 'peer-1',
      audioRecordingOwnerId: 'owner-1',
    });
    expect(element.configuredWith?.uiServices).toBe(uiServices);
    element.select();
    expect(onChange).toHaveBeenCalledOnce();

    factory.dispose(element);
    expect(element.disposed).toBe(true);
  });

  it('keeps UI services scoped to each factory', () => {
    const firstYdoc = new YDocManager();
    const secondYdoc = new YDocManager();
    const firstElement = new ConfigurableElement('first-element');
    const secondElement = new ConfigurableElement('second-element');
    const firstUiServices = {
      openChromeMenu: vi.fn(),
      openExportDialog: vi.fn(),
    };
    const secondUiServices = {
      openChromeMenu: vi.fn(),
      openExportDialog: vi.fn(),
    };
    const firstFactory = new CanvasElementFactory({
      ydoc: firstYdoc,
      getElements: () => [firstElement],
      onChange: vi.fn(),
      invalidateContentBounds: vi.fn(),
      localPeerId: '',
      audioRecordingOwnerId: '',
      uiServices: firstUiServices,
    });
    const secondFactory = new CanvasElementFactory({
      ydoc: secondYdoc,
      getElements: () => [secondElement],
      onChange: vi.fn(),
      invalidateContentBounds: vi.fn(),
      localPeerId: '',
      audioRecordingOwnerId: '',
      uiServices: secondUiServices,
    });

    firstFactory.initialize(
      firstElement,
      firstYdoc.createElementMap(ElementType.SHAPE, firstElement.uuid, {}),
    );
    secondFactory.initialize(
      secondElement,
      secondYdoc.createElementMap(ElementType.SHAPE, secondElement.uuid, {}),
    );

    expect(firstElement.configuredWith?.uiServices).toBe(firstUiServices);
    expect(secondElement.configuredWith?.uiServices).toBe(secondUiServices);
  });
});
