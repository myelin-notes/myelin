const en = {
  common: {
    close: 'Close',
    cancel: 'Cancel',
    clear: 'Clear',
    copy: 'Copy',
    copied: 'Copied',
    you: 'You',
    none: 'None',
    never: 'Never',
    or: 'or',
  },
  tabBar: {
    library: 'Library',
    home: 'Home',
    settings: 'Settings',
  },
  updater: {
    action: 'Update',
    installing: 'Updating',
    available: (version: string) =>
      `Version ${version} is available. Install it and restart.`,
    failed: 'Update failed',
  },
  sidebar: {
    searchPlaceholder: 'Search your library...',
    searchModeText: 'Text',
    searchModeSemantic: 'Semantic',
    explorer: 'Explorer',
    tags: 'Tags',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    graph: 'Open graph',
  },
  commandPalette: {
    title: 'Command Palette',
    placeholder: 'Search commands...',
    searchPlaceholder: 'Search notes...',
    loading: 'Loading...',
    noCommandResults: 'No matching commands',
    noNoteResults: 'No matching notes',
    noteResultDescription: 'Canvas note',
    footer: 'Arrow keys to navigate, Enter to run',
    sections: {
      commands: 'Commands',
      notes: 'Notes',
      recent: 'Recent notes',
    },
    commands: {
      openNote: {
        label: 'Open note',
        description: 'Jump to a recent or matching canvas',
      },
      createNote: {
        label: 'Create note',
        description: 'Start a new canvas in the library root',
      },
      openGraph: {
        label: 'Open graph',
        description: 'Map explicit links between canvas notes',
      },
      importMarkdown: {
        label: 'Import Markdown',
        description: 'Create a canvas from a Markdown file',
      },
      importMarkdownToCanvas: {
        label: 'Import Markdown',
        description: 'Add a Markdown page frame to this canvas',
      },
      switchView: {
        label: 'Switch library view',
        description: 'Toggle the library between list and grid',
      },
      refreshRepository: {
        label: 'Refresh repository',
        description: 'Pull the latest remote changes into the library',
      },
    },
    errors: {
      createNote: 'Could not create note',
      refreshRepository: 'Could not refresh repository',
    },
  },
  library: {
    title: 'Digital Library',
    emptyState: {
      title: 'Your library is empty',
      description:
        'Create a canvas to start collecting ideas, notes, and research.',
      cta: 'New Canvas',
    },
    recentlyOpened: 'Recently Opened',
    betaFeedback: {
      title: 'Beta feedback',
      description: 'Hit a bug or have an idea? Tell us in a short form.',
    },
    searchPlaceholder: 'Search studio...',
    semanticSearchLabel: 'Semantic search',
    explorer: 'Explorer',
    sortLabel: (label: string) => `Sort: ${label}`,
    sortModes: {
      'name-asc': 'Name (A-Z)',
      'name-desc': 'Name (Z-A)',
      modified: 'Recently modified',
      created: 'Recently created',
    },
    viewModeLabel: (label: string) => `View: ${label}`,
    viewModes: {
      tree: 'List',
      grid: 'Grid',
    },
    fileTypes: {
      mcanvas: 'Canvas',
    },
    createNew: {
      button: 'New',
      folder: 'New Folder',
      canvas: 'New Canvas',
      import: 'Import',
      untitledCanvas: 'Untitled Canvas',
      unnamedFolder: 'Unnamed Folder',
    },
    importPicker: {
      title: 'Import',
      description: 'Choose what you want to bring into your library.',
    },
    importSources: {
      files: {
        label: 'Files',
        description: 'Markdown, PDFs, images, and video from your computer.',
        title: 'Import Files',
        scanning: 'Reading files...',
        empty: 'None of the selected files can be imported',
        selected: (count: number) =>
          `${count} file${count === 1 ? '' : 's'} selected`,
        nativeFile:
          'Native .goodnotes files are not supported yet. Export a Goodnotes folder as PDFs, then import the ZIP.',
        summary: (count: number) =>
          `Imported ${count} file${count === 1 ? '' : 's'}`,
      },
      goodnotes_zip: {
        label: 'Goodnotes ZIP',
        description: 'A Goodnotes folder exported as PDFs.',
        title: 'Import Goodnotes ZIP',
        scanning: 'Reading archive...',
        empty: 'No PDFs found in this ZIP',
        pdfs: (count: number) => `${count} PDF${count === 1 ? '' : 's'}`,
        summary: (count: number) =>
          `Imported ${count} PDF${count === 1 ? '' : 's'}`,
      },
      onenote: {
        label: 'OneNote',
        description:
          'A .onepkg notebook or .one section exported from OneNote.',
        title: 'Import OneNote',
        scanning: 'Reading notebook...',
        empty: 'No pages found in this notebook',
        pages: (count: number) => `${count} page${count === 1 ? '' : 's'}`,
        sections: (count: number) =>
          `${count} section${count === 1 ? '' : 's'}`,
        summary: (count: number) =>
          `Imported ${count} page${count === 1 ? '' : 's'}`,
        skipped: (count: number) =>
          `${count} page${count === 1 ? '' : 's'} could not be imported`,
      },
      obsidian_vault: {
        label: 'Obsidian Vault',
        description: 'A vault folder, with its notes and attachments.',
        title: 'Import Obsidian Vault',
        scanning: 'Scanning vault...',
        empty: 'No supported files found in this vault',
      },
      workspace_json: {
        label: 'Workspace JSON',
        description: 'A folder exported from Myelin.',
        title: 'Import Workspace JSON',
        scanning: 'Scanning folder...',
        empty: 'No JSON notes or media found in this folder',
      },
    },
    importMarkdown: {
      unsupportedFile: 'Choose a Markdown file (.md, .markdown, or .mdx).',
      failed: 'Markdown import failed',
    },
    importDialog: {
      notes: (count: number) => `${count} note${count === 1 ? '' : 's'}`,
      media: (count: number) => `${count} media file${count === 1 ? '' : 's'}`,
      skippedFiles: (count: number) =>
        `${count} unsupported file${count === 1 ? '' : 's'} will be skipped`,
      conflict: {
        label: 'A folder with this name already exists',
        rename: 'Keep both (rename)',
        replace: 'Replace existing',
      },
      progress: {
        importing: (current: number, total: number) =>
          `Importing ${current} of ${total}...`,
        cancelling: 'Cancelling...',
      },
      summary: {
        title: 'Import complete',
        cancelled: 'Import cancelled',
        imported: (notes: number, media: number) =>
          `Imported ${notes} note${notes === 1 ? '' : 's'} and ${media} media file${media === 1 ? '' : 's'}`,
        skipped: (count: number) =>
          `${count} unsupported file${count === 1 ? '' : 's'} skipped`,
      },
      buttons: {
        import: 'Import',
        cancel: 'Cancel',
        done: 'Done',
      },
    },
    repositoryLoading: 'Loading repository...',
    refreshRepository: {
      label: 'Refresh repository',
      loading: 'Refreshing repository...',
      failed: 'Repository refresh failed',
    },
    semanticTags: {
      title: 'Semantic Tags',
      empty: 'No tags yet',
      emptyHint: 'Create one to filter your library.',
      insights: 'Studio Insights',
      addTag: 'New tag',
      addChild: (tag: string) => `Add tag under #${tag}`,
      placeholder: 'Tag name...',
      deleteTag: (tag: string) => `Delete #${tag}`,
      stats: {
        totalFiles: 'Total Files',
        folders: 'Folders',
        uniqueTags: 'Unique Tags',
      },
    },
    explorerTree: {
      repositorySetupRequired:
        'Repository setup required. Finish setup in Settings to view files.',
      emptySearch: 'No results found',
      emptyFilter: 'No items match the selected tags',
      emptyDefault: 'No files yet',
    },
    itemMenu: {
      rename: 'Rename',
      manageTags: 'Manage Tags',
      versionHistory: 'Version History',
      revealInFileManager: 'Reveal in File Manager',
      remove: 'Remove',
    },
    renameReferencesDialog: {
      title: 'Update linked mentions?',
      description: (mentionCount: number, noteCount: number) =>
        `${mentionCount} linked mention${mentionCount === 1 ? '' : 's'} in ${noteCount} other note${noteCount === 1 ? '' : 's'} will be rewritten to match the new name.`,
      always: 'Always update without asking',
      yes: 'Update',
      no: 'Skip',
    },
    tagDialog: {
      title: 'Manage Tags',
      description: (name: string) => `Tags on ${name}`,
      activeTags: 'Active Tags',
      noTags: 'No tags yet',
      available: 'Available',
      createNew: 'Create new tag',
      placeholder: 'Tag name...',
    },
  },
  graph: {
    title: 'Graph',
    explicitLinks: 'Explicit links',
    searchPlaceholder: 'Search graph...',
    recenter: 'Recenter',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    tags: 'Tags',
    openNote: 'Open note',
    emptySelection: 'Select a note to inspect its links.',
    noCanvasNotes: 'No canvas notes yet.',
    noLinks: 'Add explicit note links to connect this graph.',
    loadFailed: 'Could not load graph.',
    outgoing: 'Outgoing links',
    backlinks: 'Backlinks',
    graphStats: (notes: number, links: number) =>
      `${notes} note${notes === 1 ? '' : 's'}, ${links} link${links === 1 ? '' : 's'}`,
    linkCount: (incoming: number, outgoing: number) =>
      `${outgoing} outgoing, ${incoming} backlink${incoming === 1 ? '' : 's'}`,
  },
  versionHistory: {
    title: 'Version History',
    description: (name: string) => `Previous versions of ${name}`,
    empty: 'No versions yet',
    loadFailed: 'Could not load version history',
    restore: 'Restore',
    restoring: 'Restoring...',
    restored: 'Version restored',
    restoreFailed: 'Could not restore version',
  },
  settings: {
    title: 'Preferences',
    theme: {
      title: 'Theme',
      eyebrow: 'Appearance',
      options: {
        light: 'Light',
        dark: 'Dark',
        system: 'System',
      },
    },
    canvasStyle: {
      title: 'Canvas Style',
      eyebrow: 'Surface Layer',
      options: {
        grid: 'Grid',
        dots: 'Dots',
        blank: 'Blank',
      },
      backgroundColor: {
        label: 'Background color',
        description:
          'Fill the canvas behind the pattern with the theme color or one you pick.',
        options: {
          theme: 'Default',
          custom: 'Custom',
        },
        confirm: 'Apply',
      },
    },
    language: {
      title: 'Language',
      eyebrow: 'Interface',
    },
    input: {
      title: 'Input',
      eyebrow: 'Pen & Touch',
      mode: {
        label: 'Drawing input',
        description:
          'What a finger does on the canvas. Auto draws with a finger until a stylus turns up; Pen leaves drawing to the stylus; Touch always draws with a finger, and pans and zooms with two.',
        options: {
          auto: 'Auto',
          pen: 'Pen',
          touch: 'Touch',
        },
      },
    },
    pageFrameEditing: {
      title: 'Page Frame Editing',
      eyebrow: 'Document View',
      defaultPageLayout: {
        label: 'Default page layout',
        description:
          'Choose how new page frames arrange content. PDFs use Pages or Columns only.',
        options: {
          vertical: 'Pages',
          horizontal: 'Columns',
          continuous: 'Continuous',
        },
      },
      fitWholePage: {
        label: 'Fit whole page when editing',
        description:
          'Zoom out to show the full page height when entering page-frame edit mode.',
      },
      hoverPreview: {
        label: 'Show hover previews for note links',
        description:
          'Reveal a thumbnail and title when you hover a linked note.',
      },
      requireModifier: {
        label: (key: string) => `Require ${key}-click to follow links`,
        description: (key: string) =>
          `When off, a plain click follows note links and hyperlinks. When on, hold ${key} to follow, so single clicks place the cursor.`,
      },
      renameReferences: {
        label: 'Always update links after renaming notes',
        description:
          'When off, Myelin Notes asks before changing linked mentions after a note is renamed.',
      },
    },
    repository: {
      title: 'Repository',
      eyebrow: 'Sync',
      kinds: {
        local: {
          label: 'Local',
          description: 'Notes stored on this device only',
        },
        github: {
          label: 'GitHub',
          description: 'Sync to a private GitHub repository',
        },
        googleDrive: {
          label: 'Google Drive',
          description: 'Sync to a folder in your Google Drive',
        },
      },
      auth: {
        title: 'Repository Authentication',
        descriptions: {
          awaitingRedirect: (provider: string) =>
            `Finish signing in with ${provider} in your browser`,
          connected: 'Sign-in is complete',
          unavailable: 'Authentication is unavailable',
          signIn: 'Sign in to connect this repository',
        },
        errors: {
          readState: 'Failed to read authentication state.',
          signIn: 'Failed to sign in.',
        },
        buttons: {
          signIn: 'Sign in',
          signOut: 'Sign out',
        },
        browserCallback: {
          title: (provider: string) => `Signed in to ${provider}`,
          message: 'You can close this tab and return to Myelin Notes.',
        },
        notices: {
          credentialReset: (provider: string) =>
            `Your ${provider} sign-in expired and was reset. Please reconnect.`,
        },
      },
      authStatus: {
        checking: 'Checking',
        authorizing: 'Authorizing',
        connected: 'Connected',
        disconnected: 'Not connected',
      },
      sync: {
        title: 'Repository Sync',
        queuedChanges: 'Queued changes',
        lastSync: 'Last sync',
        remoteRepository: 'Remote Repository',
        driveFolder: 'Drive Folder',
        status: {
          setupRequired: {
            label: 'Setup required',
            description: 'Sign in and choose a repository to enable sync.',
          },
          loading: {
            label: 'Loading',
            description:
              'Loading the cached repository and checking the remote.',
          },
          pending: {
            label: 'Pending',
            description: (count: number, online: boolean) =>
              online
                ? `${count} change${count === 1 ? '' : 's'} queued for upload.`
                : `${count} change${count === 1 ? '' : 's'} queued locally until remote sync recovers.`,
          },
          issue: {
            label: 'Issue',
            onlineDescription:
              'The repository is configured, but the last sync attempt failed.',
            offlineDescription:
              'Remote sync is unavailable. Cached data remains available locally.',
          },
          synced: {
            label: 'Synced',
            upToDate: 'Remote repository is up to date.',
            ready: 'Repository is ready to sync.',
          },
        },
      },
      fields: {
        owner: {
          select: 'Select owner',
          loading: 'Loading account...',
          error: 'Failed to load GitHub account.',
          you: 'You',
          org: 'Org',
        },
        repo: {
          pickOwner: 'Pick owner',
          select: 'Select repository',
          loading: 'Loading repositories...',
          error: 'Failed to load repositories.',
          empty: 'No repositories',
        },
        branch: {
          pickRepo: 'Pick repo',
          select: 'Select branch',
          loading: 'Loading branches...',
          error: 'Failed to load branches.',
          empty: 'No branches',
        },
        folder: {
          label: 'Drive folder name',
          placeholder: 'Myelin',
          error: 'Failed to open the Drive folder.',
        },
      },
    },
    dataExport: {
      title: 'Data',
      eyebrow: 'Workspace',
      export: {
        label: 'Export as Obsidian Vault',
        description:
          'Save your whole workspace to a folder as an Obsidian-compatible vault. Notes become Markdown with frontmatter; other files are copied and the folder structure is preserved.',
        button: 'Export',
        defaultVaultName: 'Myelin Notes Vault',
        loading: 'Exporting Obsidian vault...',
        progress: (current: number, total: number) =>
          `Exporting ${current} of ${total}...`,
        failed: 'Obsidian vault export failed',
        succeeded: (notes: number, media: number) =>
          `Exported ${notes} note${notes === 1 ? '' : 's'} and ${media} media file${media === 1 ? '' : 's'}.`,
      },
      exportJson: {
        label: 'Export Workspace as JSON',
        description:
          'Save your whole workspace to a folder as JSON. Each note becomes a JSON file encoding its strokes, text, and embedded media (binaries as base64); other files are copied and the folder structure is preserved.',
        button: 'Export',
        defaultExportName: 'Myelin Notes JSON Export',
        loading: 'Exporting workspace as JSON...',
        progress: (current: number, total: number) =>
          `Exporting ${current} of ${total}...`,
        failed: 'JSON export failed',
        succeeded: (notes: number, media: number) =>
          `Exported ${notes} note${notes === 1 ? '' : 's'} and ${media} media file${media === 1 ? '' : 's'}.`,
      },
    },
    privacy: {
      title: 'Privacy',
      eyebrow: 'Usage Data',
      analytics: {
        label: 'Share anonymous usage analytics',
        description:
          'Send anonymous product analytics and error reports to help improve Myelin Notes. When off, nothing is sent.',
      },
      policy: {
        label: 'Privacy policy',
        description:
          'What leaves your device, who receives it, and how long it is kept. Opens trymyelin.app in your browser.',
      },
    },
    mcp: {
      title: 'Model Context Protocol',
      eyebrow: 'AI Agents',
      enabled: {
        label: 'Enable local MCP server',
        description:
          'Expose this running Myelin Notes app to local AI agents on 127.0.0.1.',
      },
      port: {
        label: 'Local port',
        description:
          'The server restarts on the new port when you leave the field.',
      },
      installPrompt: {
        label: 'Agent install prompt',
        description:
          'Copy this into your agent to connect it to this running app.',
        prompt: (endpoint: string) =>
          `Install the Myelin Notes MCP server for this running desktop app. Use Streamable HTTP with the endpoint ${endpoint}. Name the server myelin. This server is local to this computer, so Myelin Notes must stay open with MCP enabled.`,
      },
      directWrites: {
        label: 'Allow direct MCP writes',
        description:
          'Permit agents to create page frames and replace page-frame Markdown.',
      },
      startFailed: (port: number) =>
        `Couldn't start the MCP server on port ${port}`,
    },
    keybinds: {
      title: 'Keybinds',
      resetAll: 'Reset all',
      pressKey: 'Press a key...',
      unbound: 'Unbound',
      empty:
        'No keybindings registered yet. They appear once you open a canvas.',
      categories: {
        app: 'App',
        canvas: 'Canvas',
        editor: 'Editor',
      },
      actions: {
        'app:command-palette': {
          label: 'Command Palette',
          description: 'Open app commands and note navigation',
        },
        'canvas:undo': {
          label: 'Undo',
          description: 'Revert the last canvas change',
        },
        'canvas:redo': {
          label: 'Redo',
          description: 'Reapply the last reverted canvas change',
        },
        'canvas:select-all': {
          label: 'Select All',
          description: 'Select everything on the canvas',
        },
        'canvas:find': {
          label: 'Find in Canvas',
          description: 'Search text and handwriting on this canvas',
        },
        'canvas:pan': {
          label: 'Pan',
          description: 'Hold to drag the canvas',
        },
        'canvas:delete': {
          label: 'Delete',
          description: 'Remove selected elements',
        },
        'canvas:tool-select': {
          label: 'Select Tool',
          description: 'Select and move elements',
        },
        'canvas:tool-pen': {
          label: 'Pen Tool',
          description: 'Draw with the pen',
        },
        'canvas:tool-highlighter': {
          label: 'Highlighter Tool',
          description: 'Highlight with translucent ink',
        },
        'canvas:tool-eraser': {
          label: 'Eraser Tool',
          description: 'Erase strokes',
        },
        'canvas:tool-text': {
          label: 'Text Tool',
          description: 'Create a new text node',
        },
        'canvas:insert-frame': {
          label: 'Insert Page Frame',
          description: 'Place a new page frame on the canvas',
        },
        'canvas:insert-embed': {
          label: 'Insert Media',
          description: 'Insert an image, PDF, or file',
        },
        'editor:bold': {
          label: 'Bold',
          description: 'Toggle bold formatting',
        },
        'editor:italic': {
          label: 'Italic',
          description: 'Toggle italic formatting',
        },
        'editor:underline': {
          label: 'Underline',
          description: 'Toggle underline formatting',
        },
        'editor:strikethrough': {
          label: 'Strikethrough',
          description: 'Toggle strikethrough formatting',
        },
        'editor:code': {
          label: 'Code',
          description: 'Toggle inline code formatting',
        },
      },
    },
    about: {
      title: 'About',
      eyebrow: 'Application',
      version: {
        label: 'Version',
        description: 'The version of Myelin Notes currently installed.',
      },
    },
  },
  canvas: {
    kind: 'Canvas',
    frame: {
      noteKind: 'Note',
      pdfKind: 'PDF',
      displayNameLabel: 'Page frame display name',
      menu: 'Menu',
      openMenu: 'Open frame menu',
      rename: 'Rename',
      pages: 'Pages',
      continuous: 'Continuous',
      columns: 'Columns',
      export: 'Export',
    },
    export: {
      title: 'Export',
      exportCanvasPdf: 'Export canvas as PDF',
      format: 'Format',
      includeAnnotations: 'Include annotations',
      annotationsHint: 'Drawings and notes on the page',
      exporting: 'Exporting…',
      tryAgain: 'Try again',
      exportedWithWarnings: 'Exported with warnings',
      complete: 'Export complete',
    },
    search: {
      placeholder: 'Find in canvas',
      noResults: 'No results',
      next: 'Next match',
      previous: 'Previous match',
    },
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    slashInsert: {
      heading1: {
        title: 'Heading 1',
        subtitle: 'Turn this block into a top-level heading',
      },
      heading2: {
        title: 'Heading 2',
        subtitle: 'Turn this block into a section heading',
      },
      heading3: {
        title: 'Heading 3',
        subtitle: 'Turn this block into a small heading',
      },
      quote: {
        title: 'Quote',
        subtitle: 'Turn this block into a blockquote',
      },
      bulletList: {
        title: 'Bullet list',
        subtitle: 'Turn this block into a bulleted list item',
      },
      numberedList: {
        title: 'Numbered list',
        subtitle: 'Turn this block into a numbered list item',
      },
      todo: {
        title: 'To-do',
        subtitle: 'Turn this block into a checkable to-do item',
      },
      paragraph: {
        title: 'Paragraph',
        subtitle: 'Reset this block back to plain body text',
      },
      table: {
        title: 'Table',
        subtitle: 'Insert a table with header and body rows',
      },
      bold: {
        title: 'Bold',
        subtitle: 'Insert **bold** markdown',
      },
      italic: {
        title: 'Italic',
        subtitle: 'Insert *italic* markdown',
      },
      link: {
        title: 'Link',
        subtitle: 'Insert [label](url) markdown',
      },
      noteLink: {
        title: 'Note link',
        subtitle: 'Insert [[note]] link to another note',
      },
      inlineCode: {
        title: 'Inline code',
        subtitle: 'Insert `code` markdown',
      },
      embed: {
        title: 'Embed',
        subtitle: 'Insert ![alt](url) — images, videos, YouTube, link cards',
      },
      today: {
        title: 'Today',
        subtitle: "Insert today's date",
      },
      tomorrow: {
        title: 'Tomorrow',
        subtitle: "Insert tomorrow's date",
      },
      yesterday: {
        title: 'Yesterday',
        subtitle: "Insert yesterday's date",
      },
      now: {
        title: 'Now',
        subtitle: 'Insert the current date and time',
      },
    },
    backlinks: {
      title: 'Backlinks',
      linkedMentions: 'Linked mentions',
    },
    toolbar: {
      clickForOptions: 'click for options',
      customizeWheel: 'Tools & presets',
      insert: 'Insert',
    },
    selectionToolbar: {
      label: 'Selection order',
      moveHigher: 'Move forward',
      moveLower: 'Move backward',
      delete: 'Delete',
      crop: 'Crop',
      applyCrop: 'Apply crop',
    },
    insert: {
      title: 'Insert',
      soon: 'Soon',
      frame: {
        label: 'Page frame',
        description: 'A new page to write in',
      },
      embed: {
        label: 'Image or PDF',
        description: 'Drop in files or paste a URL',
      },
      latex: {
        label: 'LaTeX',
        description: 'A math block you can write equations in',
      },
      audio: {
        label: 'Audio',
        description: 'Record or import a voice memo',
      },
    },
    audioPlayer: {
      requestingMic: 'Requesting microphone...',
      requestingMicAccess: 'Requesting microphone access',
      micUnavailable: 'Microphone unavailable',
      tapToRecord: 'Tap to record',
      waitingForRecording: 'Waiting for recording',
      startRecording: 'Start recording',
      stopRecording: 'Stop recording',
      tryRecordingAgain: 'Try recording again',
      playAudio: 'Play audio',
      pauseAudio: 'Pause audio',
      transcribe: 'Transcribe audio',
      transcribing: 'Transcribing audio...',
      transcribingOn: (peer: string) => `Transcribing on ${peer}...`,
      transcriptionUnavailable:
        'Transcription requires a device that supports it',
      playFrom: (time: string) => `Play from ${time}`,
      showTranscript: 'Show transcript',
      hideTranscript: 'Hide transcript',
      noSpeechDetected: 'No speech detected',
      transcriptionFailed: 'Transcription failed',
    },
    toolShelf: {
      title: 'Tools & presets',
      empty: 'Wheel disabled - right-click will not open it.',
      tools: 'Tools',
      presets: 'Presets',
    },
    toolPresets: {
      label: (tool: string, size: number) => `${tool} · ${size}px`,
      save: 'Save current pen as preset',
      saveShort: 'Save as preset',
      saveNeedsPen: 'Pick the pen or highlighter first.',
      saveFull: (max: number) => `Presets are full - ${max} of ${max}.`,
      wheelFull: (max: number) => `Wheel is full - ${max} of ${max}.`,
      updateToCurrent: 'Update to current',
      showInWheel: 'Show in wheel',
      removeFromWheel: 'Remove from wheel',
      delete: 'Delete preset',
    },
    tools: {
      select: 'Select',
      pen: 'Pen',
      highlighter: 'Highlighter',
      eraser: 'Eraser',
      text: 'Text',
    },
    toolOptions: {
      color: 'Color',
      stroke: 'Stroke',
      size: 'Size',
      font: 'Font',
      fontSize: 'Font Size',
      mode: 'Mode',
      rectangle: 'Rectangle',
      lasso: 'Lasso',
      fine: (value: number) => `Fine (${value})`,
      medium: (value: number) => `Medium (${value})`,
      bold: (value: number) => `Bold (${value})`,
      addCustomColor: 'Add custom color',
      deleteColor: 'Delete color',
      decreaseFontSize: 'Decrease font size',
      increaseFontSize: 'Increase font size',
    },
    embedComposer: {
      dropToEmbed: 'Drop to embed',
      title: 'Add media',
      subtitle: 'Paste, drop, or pick an image or PDF.',
      readyToEmbed: 'Ready to embed',
      embedPdf: 'Embed PDF',
      embedImage: 'Embed image',
      urlPlaceholder: 'Paste a URL',
      fetch: 'Fetch',
      browse: 'Click to browse',
      dropFiles: 'or drop files here',
      pasteFromClipboard: 'paste from clipboard',
      embedded: 'embedded',
      errors: {
        unsupportedUrl: 'That link does not point to an image or PDF.',
        fetchFailed: "Couldn't fetch that link.",
        embedFailed: "Couldn't embed that file.",
        unsupportedType: 'Unsupported media type',
        unsupportedDesc: (type: string) => `${type} is not currently supported`,
      },
    },
    peerSync: {
      title: 'Peer Sync',
      host: 'Host with iroh',
      joinPlaceholder: 'Share code',
      join: 'Join',
      waitingForPeer: 'Waiting for peer...',
      shareCode: 'Share this code with a peer',
      connecting: 'Connecting...',
      connected: 'Connected',
      sync: 'Sync',
      localPeer: 'Local peer',
      writer: 'Writer',
      writerActive: 'Writer active',
      standby: 'Standby',
      repository: 'Repository',
      lastRemoteSync: 'Last remote sync',
      remotePeers: 'Remote peers',
      noRemotePeers: 'No remote peers',
      livePaused: 'Live sync paused',
      peerModes: {
        'owner-device': 'Owner device',
        'guest-editor': 'Guest editor',
        'guest-viewer': 'Guest viewer',
      },
      repositoryStatus: {
        localOnly: 'Local only',
        initializing: 'Initializing',
        offline: 'Offline',
        queued: (count: number) => `${count} queued`,
        remoteSynced: 'Remote synced',
        idle: 'Idle',
      },
      sessionPhase: {
        idle: 'Idle',
        pulling: 'Pulling',
        pushing: 'Pushing',
        closed: 'Closed',
        live: (phase: string) => `Live / ${phase}`,
      },
    },
  },
  dialogs: {
    closeSrOnly: 'Close',
  },
  onboarding: {
    skip: 'Skip setup',
    back: 'Back',
    continue: 'Continue',
    finish: 'Finish',
    stepLabel: (current: number, total: number) =>
      `Step ${current} of ${total}`,
    welcome: {
      eyebrow: 'Welcome',
      title: 'Myelin Notes',
      description:
        'An infinite canvas for handwriting, text, and everything in between. Four quick questions and you are done.',
      language: 'Language',
      start: 'Get started',
    },
    privacy: {
      eyebrow: 'Privacy',
      title: 'Help improve Myelin Notes',
      description:
        'Analytics are off until you turn them on here. You can change this any time in Settings.',
      collected:
        'What is sent: which features get used, the app version, and crash reports.',
      notCollected:
        'What is never sent: your notes, their contents, file names, or handwriting.',
      policy: 'Read the privacy policy',
    },
    sync: {
      eyebrow: 'Sync',
      title: 'Where should your notes live?',
      description:
        'Notes are stored on this device. Connect a GitHub repository or Google Drive to keep them backed up and in sync across machines.',
      later: 'You can set this up later in Settings.',
      incomplete:
        'Sign in and finish picking where notes go to continue, or choose Local to decide later.',
    },
    sample: {
      eyebrow: 'Canvas',
      title: 'Start with a sample canvas?',
      description:
        'Create a sample canvas with some feature showcase that you can play around with',
      start: 'Open the canvas',
      skip: 'Start empty',
      canvasName: 'Getting started',
      highlights: {
        frame: 'A page frame with code, math, and a Mermaid diagram',
        canvas: 'Text and LaTeX floating on the canvas beside it',
        syntax: 'A cheat sheet for the markdown shortcuts',
        checklist: 'A short checklist to try things yourself',
      },
    },
    // Content of the starter canvas. Syntax inside these strings
    // (`$E = mc^2$`, `![](…)`) is part of what the page demonstrates, so keep it
    // literal when translating.
    starter: {
      frameName: 'The basics',
      title: 'Getting started',
      intro:
        'This is a page frame: a document that lives on the canvas. Drag it, resize it, or drop another one beside it.',
      tipTitle: 'Press / to insert',
      tipBody:
        'Inside a page frame, `/` opens the insert menu: headings, tables, code, math, embeds, dates.',
      codeHeading: 'Code blocks',
      codeBody:
        'Fence a block with three backticks and a language. What you get is a real editor, not shaded text.',
      mathHeading: 'Math',
      mathBody:
        'Inline math like $E = mc^2$ sits in a sentence. Fence a block with `$$` to give it a line of its own:',
      diagramHeading: 'Mermaid diagrams',
      diagramBody: 'A code block tagged `mermaid` renders as a diagram.',
      diagramNodes: {
        idea: 'Idea',
        note: 'Note',
        canvas: 'Canvas',
      },
      syntaxHeading: 'Worth knowing',
      syntaxColumns: {
        type: 'Type this',
        get: 'To get',
      },
      syntaxRows: {
        checklist: 'A checklist',
        callout: 'A callout, like the one above',
        math: 'A block of math',
      },
      linkTip:
        'Two opening square brackets start a link to another note, and the autocomplete finishes it.',
      mediaHeading: 'Images, PDFs and video',
      mediaBody:
        'Drag a file onto the canvas, or type / inside a page and choose Embed to place one there. Paste a YouTube or Vimeo link the same way and it becomes a player.',
      checklistHeading: 'Your turn',
      checklistDone: 'Open the starter canvas',
      checklistTodo1: 'Add a page frame of your own',
      checklistTodo2: 'Write something in it',
      canvas: {
        heading: 'Out here is the canvas',
        body: 'Text boxes and LaTeX blocks float freely on it. Drag them around, scale them, or line them up beside a page.',
        latexCaption: 'A LaTeX block on the canvas:',
        toolbarHint:
          'Everything else comes from the + button at the top of the toolbar.',
      },
    },
  },
  shutdown: {
    title: 'Saving changes…',
    description: 'Syncing pending changes to your repository before quitting.',
    progress: (count: number) =>
      `Syncing ${count} change${count === 1 ? '' : 's'}…`,
    forceQuit: 'Quit anyway',
    forceQuitHint: 'Unsynced changes stay queued and will retry next launch.',
  },
};

export default en;
