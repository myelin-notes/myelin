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
      debug: 'Debug',
      settings: 'Settings',
      help: 'Help',
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
    fileTypes: {
      mcanvas: 'Canvas',
    },
    createNew: {
      button: 'New',
      folder: 'New Folder',
      canvas: 'New Canvas',
      untitledCanvas: 'Untitled Canvas',
      unnamedFolder: 'Unnamed Folder',
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
        title: 'GitHub Authentication',
        descriptions: {
          polling: 'Enter the code on GitHub to finish signing in',
          connected: 'Signed in via GitHub',
          unavailable: 'GitHub authentication is unavailable',
          signIn: 'Sign in with your GitHub account',
        },
        errors: {
          readState: 'Failed to read GitHub authentication state.',
          signIn: 'Failed to sign in.',
        },
        buttons: {
          signIn: 'Sign in',
          signOut: 'Sign out',
        },
        deviceCode: 'Enter this code on GitHub',
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
        canvas: 'Canvas',
        editor: 'Editor',
      },
      actions: {
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
    toolbar: {
      clickForOptions: 'click for options',
      customizeWheel: 'Customize wheel',
      insert: 'Insert',
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
      link: {
        label: 'Note link',
        description: 'Link or embed another note',
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
  debug: {
    uploadPdf: 'Upload PDF',
    empty: 'Select a PDF to render.',
  },
  dialogs: {
    closeSrOnly: 'Close',
  },
};

export default en;
