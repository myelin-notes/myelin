import { describe, expect, it } from 'vitest';
import en from '@myelin/editor/i18n/messages/en';
import { getImportProvider, IMPORT_PROVIDERS } from './index';

describe('import provider registry', () => {
  it('registers every provider exactly once', () => {
    const ids = IMPORT_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has an i18n block for every provider', () => {
    for (const { id } of IMPORT_PROVIDERS) {
      const source = en.library.importSources[id];
      expect(source, `missing importSources.${id}`).toBeDefined();
      expect(source.label).toBeTruthy();
      expect(source.description).toBeTruthy();
      expect(source.title).toBeTruthy();
      expect(source.scanning).toBeTruthy();
      expect(source.empty).toBeTruthy();
    }
  });

  it('resolves each registered id', () => {
    for (const provider of IMPORT_PROVIDERS) {
      expect(getImportProvider(provider.id)).toBe(provider);
    }
  });

  it('declares a file accept string for every file-based provider', () => {
    for (const { id, picker } of IMPORT_PROVIDERS) {
      if (picker.kind === 'files') {
        expect(picker.accept, `empty accept for ${id}`).toBeTruthy();
      }
    }
  });
});
