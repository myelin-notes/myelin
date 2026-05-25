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
  app: {
    name: 'Myelin',
    tagline: 'Digital Studio',
  },
  sidebar: {
    newCanvas: 'New Canvas',
    nav: {
      library: 'Library',
      graph: 'Graph',
      settings: 'Settings',
      help: 'Help',
    },
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
    emptyState:
      'Your personal knowledge workspace. Create a canvas to start collecting ideas, notes, and research.',
    recentlyOpened: 'Recently Opened',
    searchPlaceholder: 'Search studio...',
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
      importFiles: 'Import Files',
      importGoodnotesZip: 'Import Goodnotes ZIP',
      importObsidianVault: 'Import Obsidian Vault',
      untitledCanvas: 'Untitled Canvas',
      unnamedFolder: 'Unnamed Folder',
    },
    importMarkdown: {
      unsupportedFile: 'Choose a Markdown file (.md, .markdown, or .mdx).',
      failed: 'Markdown import failed',
    },
    importFiles: {
      unsupportedFile: 'Choose a Markdown, PDF, image, or video file.',
      someUnsupported: 'Some files were not supported.',
      failed: 'Import failed',
      loading: 'Importing files...',
    },
    importGoodnotesZip: {
      unsupportedFile: 'Choose a ZIP exported from Goodnotes as PDFs.',
      nativeFile:
        'Native .goodnotes files are not supported yet. Export a Goodnotes folder as PDFs, then import the ZIP.',
      failed: 'Goodnotes ZIP import failed',
      skipped: (count: number) =>
        `${count} unsupported file${count === 1 ? '' : 's'} skipped.`,
    },
    importObsidianVault: {
      failed: 'Obsidian vault import failed',
      loading: 'Importing Obsidian vault...',
      skipped: (count: number) =>
        `${count} unsupported file${count === 1 ? '' : 's'} skipped.`,
      succeeded: (notes: number, media: number) =>
        `Imported ${notes} note${notes === 1 ? '' : 's'} and ${media} media file${media === 1 ? '' : 's'}.`,
    },
    importDialog: {
      title: 'Import Obsidian Vault',
      scanning: 'Scanning vault...',
      notes: (count: number) => `${count} note${count === 1 ? '' : 's'}`,
      media: (count: number) => `${count} media file${count === 1 ? '' : 's'}`,
      skippedFiles: (count: number) =>
        `${count} unsupported file${count === 1 ? '' : 's'} will be skipped`,
      noFiles: 'No supported files found in this vault',
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
      empty:
        'No tags yet. Right-click a file and choose "Manage Tags" to start.',
      insights: 'Studio Insights',
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
  settings: {
    title: 'Preferences',
    description:
      'Customize your creative sanctuary. These settings adjust the visual atmosphere and functional depth of your infinite canvas.',
    canvasStyle: {
      title: 'Canvas Style',
      eyebrow: 'Surface Layer',
      options: {
        grid: 'Grid',
        dots: 'Dots',
        blank: 'Blank',
      },
    },
    language: {
      title: 'Language',
      eyebrow: 'Interface',
    },
    pageFrameEditing: {
      title: 'Page Frame Editing',
      eyebrow: 'Document View',
      defaultOrientation: {
        label: 'Default page orientation',
        description: 'Choose how new page frames and PDFs arrange pages.',
        options: {
          vertical: 'Vertical',
          horizontal: 'Horizontal',
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
          'When off, Myelin asks before changing linked mentions after a note is renamed.',
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
      },
      auth: {
        title: 'Repository Authentication',
        descriptions: {
          polling: 'Enter the code in your browser to finish signing in',
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
        deviceCode: 'Enter this code in your browser',
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
      },
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
  },
  canvas: {
    kind: 'Canvas',
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    backlinks: {
      title: 'Backlinks',
      linkedMentions: 'Linked mentions',
    },
    toolbar: {
      clickForOptions: 'click for options',
      customizeWheel: 'Customize wheel',
      insert: 'Insert',
    },
    selectionToolbar: {
      label: 'Selection order',
      moveHigher: 'Move forward',
      moveLower: 'Move backward',
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
    },
    toolShelf: {
      title: 'Tool Shelf',
      empty: 'Wheel disabled - right-click will not open it.',
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
    versionHistory: {
      title: 'Version history',
      current: 'Current version',
      restore: 'Restore',
      restoreConfirmTitle: 'Restore this version?',
      restoreConfirmDescription:
        'Your current version will be saved before restoring.',
      empty: 'No saved versions yet',
      cancel: 'Cancel',
    },
  },
  dialogs: {
    closeSrOnly: 'Close',
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
