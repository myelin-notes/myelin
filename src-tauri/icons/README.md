The macOS icon uses `macos-icon.svg`: an 824px white tile on a 1024px transparent canvas. Keep the transparent margins and rounded corners so macOS Tahoe does not add its gray container.

To regenerate it from the repository root:

```sh
yarn tauri icon src-tauri/icons/macos-icon.svg --output /tmp/myelin-macos-icons
cp /tmp/myelin-macos-icons/icon.icns src-tauri/icons/icon.icns
```

Copy only the `.icns`; the other platforms use their existing assets.
