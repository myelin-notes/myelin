import type en from './en';

const zhHans: typeof en = {
  common: {
    close: '关闭',
    cancel: '取消',
    clear: '清除',
    copy: '复制',
    copied: '已复制',
    you: '你',
    none: '无',
    never: '从不',
    or: '或',
  },
  tabBar: {
    library: '资料库',
    home: '主页',
    settings: '设置',
  },
  sidebar: {
    searchPlaceholder: '搜索你的资料库…',
    searchModeText: '文本',
    searchModeSemantic: '语义',
    explorer: '资源管理器',
    tags: '标签',
    collapse: '收起侧边栏',
    expand: '展开侧边栏',
    graph: '打开关系图谱',
  },
  commandPalette: {
    title: '命令面板',
    placeholder: '搜索命令…',
    searchPlaceholder: '搜索笔记…',
    loading: '正在加载…',
    noCommandResults: '没有匹配的命令',
    noNoteResults: '没有匹配的笔记',
    noteResultDescription: '画布笔记',
    footer: '使用方向键导航，按 Enter 执行',
    sections: {
      commands: '命令',
      notes: '笔记',
      recent: '最近笔记',
    },
    commands: {
      openNote: {
        label: '打开笔记',
        description: '跳转到最近或匹配的画布',
      },
      createNote: {
        label: '新建笔记',
        description: '在资料库根目录创建新画布',
      },
      openGraph: {
        label: '打开关系图谱',
        description: '呈现画布笔记之间的显式链接',
      },
      importMarkdown: {
        label: '导入 Markdown',
        description: '从 Markdown 文件创建画布',
      },
      importMarkdownToCanvas: {
        label: '导入 Markdown',
        description: '向当前画布添加 Markdown 页面框',
      },
      switchView: {
        label: '切换资料库视图',
        description: '在资料库的列表视图与网格视图之间切换',
      },
      refreshRepository: {
        label: '刷新仓库',
        description: '将最新的远程更改拉取到资料库',
      },
    },
    errors: {
      createNote: '无法创建笔记',
      refreshRepository: '无法刷新仓库',
    },
  },
  library: {
    title: '数字资料库',
    emptyState: {
      title: '你的资料库还是空的',
      description: '创建画布，开始收集想法、笔记与研究资料。',
      cta: '新建画布',
    },
    recentlyOpened: '最近打开',
    searchPlaceholder: '搜索工作室…',
    semanticSearchLabel: '语义搜索',
    explorer: '资源管理器',
    sortLabel: (label: string) => `排序：${label}`,
    sortModes: {
      'name-asc': '名称（A-Z）',
      'name-desc': '名称（Z-A）',
      modified: '最近修改',
      created: '最近创建',
    },
    viewModeLabel: (label: string) => `视图：${label}`,
    viewModes: {
      tree: '列表',
      grid: '网格',
    },
    fileTypes: {
      mcanvas: '画布',
    },
    createNew: {
      button: '新建',
      folder: '新建文件夹',
      canvas: '新建画布',
      import: '导入',
      untitledCanvas: '未命名画布',
      unnamedFolder: '未命名文件夹',
    },
    importPicker: {
      title: '导入',
      description: '选择要导入到库中的内容。',
      files: {
        label: '文件',
        description: '来自电脑的 Markdown、PDF、图片和视频。',
      },
      goodnotesZip: {
        label: 'Goodnotes ZIP',
        description: '以 PDF 形式导出的 Goodnotes 文件夹。',
      },
      obsidianVault: {
        label: 'Obsidian 仓库',
        description: '仓库文件夹，包含其笔记和附件。',
      },
      workspaceJson: {
        label: '工作区 JSON',
        description: '从 Myelin 导出的文件夹。',
      },
    },
    importMarkdown: {
      unsupportedFile: '请选择 Markdown 文件（.md、.markdown 或 .mdx）',
      failed: 'Markdown 导入失败',
    },
    importFiles: {
      unsupportedFile: '请选择 Markdown、PDF、图片或视频文件',
      someUnsupported: '部分文件不受支持',
      failed: '导入失败',
      loading: '正在导入文件…',
    },
    importGoodnotesZip: {
      unsupportedFile: '请选择从 Goodnotes 导出为 PDF 的 ZIP 文件',
      nativeFile:
        '暂不支持原生 .goodnotes 文件。请先在 Goodnotes 中将文件夹导出为 PDF，再导入该 ZIP。',
      failed: 'Goodnotes ZIP 导入失败',
      skipped: (count: number) => `已跳过 ${count} 个不受支持的文件`,
    },
    importObsidianVault: {
      failed: 'Obsidian 仓库导入失败',
      loading: '正在导入 Obsidian 仓库…',
      skipped: (count: number) => `已跳过 ${count} 个不受支持的文件`,
      succeeded: (notes: number, media: number) =>
        `已导入 ${notes} 个笔记和 ${media} 个媒体文件`,
    },
    importDialog: {
      title: '导入 Obsidian 仓库',
      scanning: '正在扫描仓库…',
      jsonTitle: '导入工作区 JSON',
      jsonScanning: '正在扫描文件夹…',
      jsonNoFiles: '此文件夹中未找到 JSON 笔记或媒体文件',
      notes: (count: number) => `${count} 个笔记`,
      media: (count: number) => `${count} 个媒体文件`,
      skippedFiles: (count: number) => `将跳过 ${count} 个不受支持的文件`,
      noFiles: '此仓库中未找到受支持的文件',
      conflict: {
        label: '已存在同名文件夹',
        rename: '两者都保留（重命名）',
        replace: '替换现有文件夹',
      },
      progress: {
        importing: (current: number, total: number) =>
          `正在导入 ${current}/${total}…`,
        cancelling: '正在取消…',
      },
      summary: {
        title: '导入完成',
        cancelled: '导入已取消',
        imported: (notes: number, media: number) =>
          `已导入 ${notes} 个笔记和 ${media} 个媒体文件`,
        skipped: (count: number) => `已跳过 ${count} 个不受支持的文件`,
      },
      buttons: {
        import: '导入',
        cancel: '取消',
        done: '完成',
      },
    },
    repositoryLoading: '正在加载仓库…',
    refreshRepository: {
      label: '刷新仓库',
      loading: '正在刷新仓库…',
      failed: '仓库刷新失败',
    },
    semanticTags: {
      title: '语义标签',
      empty: '还没有标签',
      emptyHint: '创建一个标签以筛选你的资料库。',
      insights: '工作室洞察',
      addTag: '新建标签',
      addChild: (tag: string) => `在 #${tag} 下添加标签`,
      placeholder: '标签名称…',
      deleteTag: (tag: string) => `删除 #${tag}`,
      stats: {
        totalFiles: '文件总数',
        folders: '文件夹',
        uniqueTags: '标签数',
      },
    },
    explorerTree: {
      repositorySetupRequired: '请先在设置中完成仓库配置，才能查看文件',
      emptySearch: '未找到结果',
      emptyFilter: '没有符合所选标签的项目',
      emptyDefault: '还没有文件',
    },
    itemMenu: {
      rename: '重命名',
      manageTags: '管理标签',
      versionHistory: '版本历史',
      revealInFileManager: '在文件管理器中显示',
      remove: '移除',
    },
    renameReferencesDialog: {
      title: '更新链接提及？',
      description: (mentionCount: number, noteCount: number) =>
        `将改写 ${noteCount} 篇其他笔记中的 ${mentionCount} 处链接提及，使其与新名称一致。`,
      always: '始终更新，不再询问',
      yes: '更新',
      no: '跳过',
    },
    tagDialog: {
      title: '管理标签',
      description: (name: string) => `${name} 的标签`,
      activeTags: '已添加的标签',
      noTags: '还没有标签',
      available: '可添加',
      createNew: '创建新标签',
      placeholder: '标签名称…',
    },
  },
  graph: {
    title: '关系图谱',
    explicitLinks: '显式链接',
    searchPlaceholder: '搜索关系图谱…',
    recenter: '重新居中',
    zoomIn: '放大',
    zoomOut: '缩小',
    tags: '标签',
    openNote: '打开笔记',
    emptySelection: '选择一篇笔记以查看其链接。',
    noCanvasNotes: '还没有画布笔记。',
    noLinks: '添加显式笔记链接以连接此关系图谱。',
    loadFailed: '无法加载关系图谱。',
    outgoing: '传出链接',
    backlinks: '反向链接',
    graphStats: (notes: number, links: number) =>
      `${notes} 篇笔记，${links} 条链接`,
    linkCount: (incoming: number, outgoing: number) =>
      `${outgoing} 条传出，${incoming} 条反向链接`,
  },
  versionHistory: {
    title: '版本历史',
    description: (name: string) => `${name} 的历史版本`,
    empty: '还没有版本',
    loadFailed: '无法加载版本历史',
    restore: '恢复',
    restoring: '正在恢复…',
    restored: '版本已恢复',
    restoreFailed: '无法恢复版本',
  },
  settings: {
    title: '偏好设置',
    theme: {
      title: '主题',
      eyebrow: '外观',
      options: {
        light: '浅色',
        dark: '深色',
        system: '跟随系统',
      },
    },
    canvasStyle: {
      title: '画布样式',
      eyebrow: '视觉外观',
      options: {
        grid: '网格',
        dots: '点阵',
        blank: '空白',
      },
      backgroundColor: {
        label: '背景颜色',
        description: '用主题颜色或自定义颜色填充图案背后的画布。',
        options: {
          theme: '默认',
          custom: '自定义',
        },
        confirm: '应用',
      },
    },
    language: {
      title: '语言',
      eyebrow: '界面语言',
    },
    pageFrameEditing: {
      title: '页面框编辑',
      eyebrow: '文档视图',
      defaultPageLayout: {
        label: '默认页面布局',
        description: '选择新页面框的内容排列方式。PDF 仅支持页面或分栏。',
        options: {
          vertical: '页面',
          horizontal: '分栏',
          continuous: '连续',
        },
      },
      fitWholePage: {
        label: '编辑时适配整页',
        description: '进入页面框编辑模式时缩小视图，显示完整页面高度。',
      },
      hoverPreview: {
        label: '显示笔记链接的悬停预览',
        description: '将光标悬停在笔记链接上时，显示缩略图和标题。',
      },
      requireModifier: {
        label: (key: string) => `需要 ${key}+单击 才能打开链接`,
        description: (key: string) =>
          `关闭时，单击即可打开笔记链接和超链接；开启后，需按住 ${key} 才能打开，普通单击则用于定位光标。`,
      },
      renameReferences: {
        label: '重命名笔记后始终更新链接',
        description:
          '关闭时，笔记重命名后 Myelin Notes 会先询问是否更改链接提及。',
      },
    },
    repository: {
      title: '仓库',
      eyebrow: '数据同步',
      kinds: {
        local: {
          label: '本地',
          description: '笔记仅存储在此设备上',
        },
        github: {
          label: 'GitHub',
          description: '同步到私有 GitHub 仓库',
        },
        googleDrive: {
          label: 'Google 云端硬盘',
          description: '同步到你的 Google 云端硬盘中的文件夹',
        },
      },
      auth: {
        title: '仓库身份验证',
        descriptions: {
          polling: '在浏览器中输入代码以完成登录',
          connected: '登录已完成',
          unavailable: '身份验证不可用',
          signIn: '登录以连接此仓库',
        },
        errors: {
          readState: '无法读取身份验证状态',
          signIn: '登录失败',
        },
        buttons: {
          signIn: '登录',
          signOut: '退出登录',
        },
        deviceCode: '在浏览器中输入此代码',
        notices: {
          credentialReset: (provider: string) =>
            `你的 ${provider} 登录凭据已过期并被重置，请重新连接。`,
        },
      },
      authStatus: {
        checking: '检查中',
        authorizing: '授权中',
        connected: '已连接',
        disconnected: '未连接',
      },
      sync: {
        title: '仓库同步',
        queuedChanges: '排队中的更改',
        lastSync: '上次同步',
        remoteRepository: '远程仓库',
        driveFolder: '云端硬盘文件夹',
        status: {
          setupRequired: {
            label: '需要设置',
            description: '登录并选择一个仓库以启用同步',
          },
          loading: {
            label: '加载中',
            description: '正在加载缓存的仓库并检查远程状态',
          },
          pending: {
            label: '待处理',
            description: (count: number, online: boolean) =>
              online
                ? `${count} 项更改正在排队上传`
                : `${count} 项更改已在本地排队，将在远程同步恢复后上传`,
          },
          issue: {
            label: '异常',
            onlineDescription: '仓库已配置，但上次同步尝试失败',
            offlineDescription: '远程同步不可用，本地仍可访问缓存数据',
          },
          synced: {
            label: '已同步',
            upToDate: '远程仓库已是最新',
            ready: '仓库已就绪，可以同步',
          },
        },
      },
      fields: {
        owner: {
          select: '选择所有者',
          loading: '正在加载账户…',
          error: '无法加载 GitHub 账户',
          you: '你',
          org: '组织',
        },
        repo: {
          pickOwner: '选择所有者',
          select: '选择仓库',
          loading: '正在加载仓库…',
          error: '无法加载仓库',
          empty: '没有仓库',
        },
        branch: {
          pickRepo: '选择仓库',
          select: '选择分支',
          loading: '正在加载分支…',
          error: '无法加载分支',
          empty: '没有分支',
        },
        folder: {
          label: '云端硬盘文件夹名称',
          placeholder: 'Myelin',
          error: '无法打开云端硬盘文件夹。',
        },
      },
    },
    dataExport: {
      title: '数据',
      eyebrow: '工作区',
      export: {
        label: '导出为 Obsidian 仓库',
        description:
          '将整个工作区保存到文件夹中，作为兼容 Obsidian 的仓库。笔记会转换为带 frontmatter 的 Markdown；其他文件会被复制，并保留文件夹结构。',
        button: '导出',
        defaultVaultName: 'Myelin Notes 仓库',
        loading: '正在导出 Obsidian 仓库…',
        progress: (current: number, total: number) =>
          `正在导出 ${current} / ${total}…`,
        failed: 'Obsidian 仓库导出失败',
        succeeded: (notes: number, media: number) =>
          `已导出 ${notes} 个笔记和 ${media} 个媒体文件`,
      },
      exportJson: {
        label: '将工作区导出为 JSON',
        description:
          '将整个工作区保存到文件夹中，格式为 JSON。每个笔记会编码为一个 JSON 文件，包含其笔迹、文本和嵌入的媒体（二进制以 base64 编码）；其他文件会被复制，并保留文件夹结构。',
        button: '导出',
        defaultExportName: 'Myelin Notes JSON 导出',
        loading: '正在将工作区导出为 JSON…',
        progress: (current: number, total: number) =>
          `正在导出 ${current} / ${total}…`,
        failed: 'JSON 导出失败',
        succeeded: (notes: number, media: number) =>
          `已导出 ${notes} 个笔记和 ${media} 个媒体文件`,
      },
    },
    privacy: {
      title: '隐私',
      eyebrow: '使用数据',
      analytics: {
        label: '共享匿名使用数据',
        description:
          '发送匿名的产品使用数据和错误报告，帮助改进 Myelin Notes。关闭后将不会发送任何内容。',
      },
      policy: {
        label: '隐私政策',
        description:
          '哪些数据会离开你的设备、由谁接收、保留多久。在浏览器中打开 trymyelin.app。',
      },
    },
    mcp: {
      title: 'Model Context Protocol',
      eyebrow: 'AI 代理',
      enabled: {
        label: '启用本地 MCP 服务器',
        description:
          '将正在运行的 Myelin Notes 应用开放给 127.0.0.1 上的本地 AI 代理。',
      },
      port: {
        label: '本地端口',
        description: '离开输入框后，服务器将在新端口上重启。',
      },
      installPrompt: {
        label: '代理安装提示词',
        description: '复制到你的代理中，即可将其连接到正在运行的此应用。',
        prompt: (endpoint: string) =>
          `为正在运行的 Myelin Notes 桌面应用安装 MCP 服务器。使用 Streamable HTTP，端点为 ${endpoint}。将服务器命名为 myelin。此服务器只在本机可用，因此 Myelin Notes 必须保持打开并启用 MCP。`,
      },
      directWrites: {
        label: '允许直接 MCP 写入',
        description: '允许代理创建页面框并替换页面框的 Markdown。',
      },
      startFailed: (port: number) => `无法在端口 ${port} 上启动 MCP 服务器`,
    },
    keybinds: {
      title: '快捷键',
      resetAll: '全部重置',
      pressKey: '按下按键…',
      unbound: '未绑定',
      empty: '还没有注册快捷键，打开画布后即可查看',
      categories: {
        app: '应用',
        canvas: '画布',
        editor: '编辑器',
      },
      actions: {
        'app:command-palette': {
          label: '命令面板',
          description: '打开应用命令和笔记导航',
        },
        'canvas:undo': {
          label: '撤销',
          description: '撤销上一次画布更改',
        },
        'canvas:redo': {
          label: '重做',
          description: '重新应用上一次撤销的画布更改',
        },
        'canvas:select-all': {
          label: '全选',
          description: '选中画布上的全部内容',
        },
        'canvas:find': {
          label: '在画布中查找',
          description: '搜索此画布上的文字和手写内容',
        },
        'canvas:pan': {
          label: '平移',
          description: '按住以拖动画布',
        },
        'canvas:delete': {
          label: '删除',
          description: '移除所选元素',
        },
        'canvas:tool-select': {
          label: '选择工具',
          description: '选择并移动元素',
        },
        'canvas:tool-pen': {
          label: '钢笔工具',
          description: '使用钢笔绘制',
        },
        'canvas:tool-highlighter': {
          label: '荧光笔工具',
          description: '使用半透明墨水高亮',
        },
        'canvas:tool-eraser': {
          label: '橡皮擦工具',
          description: '擦除笔画',
        },
        'canvas:tool-text': {
          label: '文本工具',
          description: '创建新的文本节点',
        },
        'canvas:insert-frame': {
          label: '插入页面框',
          description: '在画布上放置新的页面框',
        },
        'canvas:insert-embed': {
          label: '插入媒体',
          description: '插入图片、PDF 或文件',
        },
        'editor:bold': {
          label: '粗体',
          description: '切换粗体格式',
        },
        'editor:italic': {
          label: '斜体',
          description: '切换斜体格式',
        },
        'editor:underline': {
          label: '下划线',
          description: '切换下划线格式',
        },
        'editor:strikethrough': {
          label: '删除线',
          description: '切换删除线格式',
        },
        'editor:code': {
          label: '代码',
          description: '切换行内代码格式',
        },
      },
    },
    about: {
      title: '关于',
      eyebrow: '应用程序',
      version: {
        label: '版本',
        description: '当前安装的 Myelin Notes 版本。',
      },
    },
  },
  canvas: {
    kind: '画布',
    frame: {
      noteKind: '笔记',
      pdfKind: 'PDF',
      displayNameLabel: '页面框显示名称',
      menu: '菜单',
      openMenu: '打开页面框菜单',
      rename: '重命名',
      pages: '页面',
      continuous: '连续',
      columns: '分栏',
      export: '导出',
    },
    export: {
      title: '导出',
      exportCanvasPdf: '将画布导出为 PDF',
      format: '格式',
      includeAnnotations: '包含批注',
      annotationsHint: '页面上的绘图和笔记',
      exporting: '正在导出…',
      tryAgain: '重试',
      exportedWithWarnings: '导出完成，但有警告',
      complete: '导出完成',
    },
    search: {
      placeholder: '在画布中查找',
      noResults: '无结果',
      next: '下一个匹配',
      previous: '上一个匹配',
    },
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    slashInsert: {
      heading1: {
        title: '一级标题',
        subtitle: '将此块转换为顶级标题',
      },
      heading2: {
        title: '二级标题',
        subtitle: '将此块转换为章节标题',
      },
      heading3: {
        title: '三级标题',
        subtitle: '将此块转换为小标题',
      },
      quote: {
        title: '引用',
        subtitle: '将此块转换为引用块',
      },
      bulletList: {
        title: '项目符号列表',
        subtitle: '将此块转换为项目符号列表项',
      },
      numberedList: {
        title: '编号列表',
        subtitle: '将此块转换为编号列表项',
      },
      todo: {
        title: '待办事项',
        subtitle: '将此块转换为可勾选的待办事项',
      },
      paragraph: {
        title: '段落',
        subtitle: '将此块重置为纯正文文本',
      },
      table: {
        title: '表格',
        subtitle: '插入包含表头和正文行的表格',
      },
      bold: {
        title: '粗体',
        subtitle: '插入 **粗体** Markdown',
      },
      italic: {
        title: '斜体',
        subtitle: '插入 *斜体* Markdown',
      },
      link: {
        title: '链接',
        subtitle: '插入 [标签](url) Markdown',
      },
      noteLink: {
        title: '笔记链接',
        subtitle: '插入指向其他笔记的 [[笔记]] 链接',
      },
      inlineCode: {
        title: '行内代码',
        subtitle: '插入 `代码` Markdown',
      },
      embed: {
        title: '嵌入',
        subtitle: '插入 ![alt](url) — 图片、视频、YouTube、链接卡片',
      },
      today: {
        title: '今天',
        subtitle: '插入今天的日期',
      },
      tomorrow: {
        title: '明天',
        subtitle: '插入明天的日期',
      },
      yesterday: {
        title: '昨天',
        subtitle: '插入昨天的日期',
      },
      now: {
        title: '现在',
        subtitle: '插入当前日期和时间',
      },
    },
    backlinks: {
      title: '反向链接',
      linkedMentions: '链接提及',
    },
    toolbar: {
      clickForOptions: '点击查看选项',
      customizeWheel: '自定义轮盘',
      insert: '插入',
    },
    selectionToolbar: {
      label: '选区层级',
      moveHigher: '前移一层',
      moveLower: '后移一层',
      delete: '删除',
      crop: '裁剪',
      applyCrop: '应用裁剪',
    },
    insert: {
      title: '插入',
      soon: '即将推出',
      frame: {
        label: '页面框',
        description: '可书写的新页面',
      },
      embed: {
        label: '图片或 PDF',
        description: '拖入文件或粘贴链接',
      },
      latex: {
        label: 'LaTeX',
        description: '可书写公式的数学块',
      },
      audio: {
        label: '音频',
        description: '录制或导入语音备忘',
      },
    },
    audioPlayer: {
      requestingMic: '正在请求麦克风…',
      requestingMicAccess: '正在请求麦克风权限',
      micUnavailable: '麦克风不可用',
      tapToRecord: '点按录音',
      waitingForRecording: '正在等待录音',
      startRecording: '开始录音',
      stopRecording: '停止录音',
      tryRecordingAgain: '重新尝试录音',
      playAudio: '播放音频',
      pauseAudio: '暂停音频',
      transcribe: '转录音频',
      transcribing: '正在转录音频…',
      transcribingOn: (peer: string) => `正在 ${peer} 上转录…`,
      transcriptionUnavailable: '转录需要支持转录的设备',
      showTranscript: '显示转录文本',
      hideTranscript: '隐藏转录文本',
      noSpeechDetected: '未检测到语音',
      transcriptionFailed: '转录失败',
    },
    toolShelf: {
      title: '工具架',
      empty: '轮盘已停用，右键点击将不会打开',
    },
    tools: {
      select: '选择',
      pen: '钢笔',
      highlighter: '荧光笔',
      eraser: '橡皮擦',
      text: '文本',
    },
    toolOptions: {
      color: '颜色',
      stroke: '笔触',
      size: '大小',
      font: '字体',
      fontSize: '字号',
      mode: '模式',
      rectangle: '矩形',
      lasso: '套索',
      fine: (value: number) => `细（${value}）`,
      medium: (value: number) => `中（${value}）`,
      bold: (value: number) => `粗（${value}）`,
      addCustomColor: '添加自定义颜色',
      decreaseFontSize: '减小字号',
      increaseFontSize: '增大字号',
    },
    embedComposer: {
      dropToEmbed: '拖放以嵌入',
      title: '添加媒体',
      subtitle: '粘贴、拖放或选择图片或 PDF',
      readyToEmbed: '准备嵌入',
      embedPdf: '嵌入 PDF',
      embedImage: '嵌入图片',
      urlPlaceholder: '粘贴链接',
      fetch: '获取',
      browse: '点击浏览',
      dropFiles: '或将文件拖放到这里',
      pasteFromClipboard: '从剪贴板粘贴',
      embedded: '已嵌入',
      errors: {
        unsupportedUrl: '该链接指向的不是图片或 PDF',
        fetchFailed: '无法获取该链接',
        embedFailed: '无法嵌入该文件',
        unsupportedType: '不支持的媒体类型',
        unsupportedDesc: (type: string) => `暂不支持 ${type}`,
      },
    },
    peerSync: {
      title: '协作同步',
      host: '使用 iroh 托管',
      joinPlaceholder: '输入共享代码',
      join: '加入',
      waitingForPeer: '等待对等方…',
      shareCode: '将此代码分享给协作方',
      connecting: '连接中…',
      connected: '已连接',
      sync: '同步',
      localPeer: '本地节点',
      writer: '编辑者',
      writerActive: '编辑者活跃',
      standby: '待命',
      repository: '仓库',
      lastRemoteSync: '上次远程同步',
      remotePeers: '远程节点',
      noRemotePeers: '没有远程节点',
      livePaused: '实时同步已暂停',
      peerModes: {
        'owner-device': '所有者设备',
        'guest-editor': '访客编辑',
        'guest-viewer': '访客查看',
      },
      repositoryStatus: {
        localOnly: '仅本地',
        initializing: '初始化中',
        offline: '离线',
        queued: (count: number) => `${count} 项排队中`,
        remoteSynced: '远程已同步',
        idle: '空闲',
      },
      sessionPhase: {
        idle: '空闲',
        pulling: '正在拉取',
        pushing: '正在推送',
        closed: '已关闭',
        live: (phase: string) => `实时 / ${phase}`,
      },
    },
  },
  dialogs: {
    closeSrOnly: '关闭',
  },
  shutdown: {
    title: '正在保存更改…',
    description: '退出前正在将待同步的更改推送到仓库。',
    progress: (count: number) => `正在同步 ${count} 项更改…`,
    forceQuit: '仍要退出',
    forceQuitHint: '未同步的更改会保留在队列中，下次启动时重试。',
  },
};

export default zhHans;
