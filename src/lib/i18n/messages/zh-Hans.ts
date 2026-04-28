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
  app: {
    name: 'Myelin',
    tagline: '数字工作室',
  },
  sidebar: {
    newCanvas: '新建画布',
    nav: {
      library: '资料库',
      graph: '关系图',
      debug: '调试',
      settings: '设置',
      help: '帮助',
    },
  },
  commandPalette: {
    title: '命令面板',
    placeholder: '搜索命令...',
    searchPlaceholder: '搜索笔记...',
    loading: '正在加载...',
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
        label: '创建笔记',
        description: '在资料库根目录创建新画布',
      },
      importMarkdown: {
        label: '导入 Markdown',
        description: '从 Markdown 文件创建画布',
      },
      importMarkdownToCanvas: {
        label: '导入 Markdown',
        description: '向当前画布添加 Markdown 页面框',
      },
      insertLink: {
        label: '插入笔记链接',
        description: '需要路线图第 2 项的内部笔记链接',
      },
      switchView: {
        label: '切换资料库视图',
        description: '在列表和网格之间切换资料库',
      },
    },
    errors: {
      createNote: '无法创建笔记',
    },
  },
  library: {
    title: '数字资料库',
    emptyState: '你的个人知识工作区，创建画布即可开始收集想法、笔记与研究',
    recentlyOpened: '最近打开',
    searchPlaceholder: '搜索工作室...',
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
      importMarkdown: '导入 Markdown',
      importFiles: '导入文件',
      untitledCanvas: '未命名画布',
      unnamedFolder: '未命名文件夹',
    },
    importMarkdown: {
      unsupportedFile: '请选择 Markdown 文件（.md、.markdown 或 .mdx）',
      failed: 'Markdown 导入失败',
    },
    importFiles: {
      unsupportedFile: '请选择图片或视频文件',
      someUnsupported: '部分文件不受支持',
      failed: '文件导入失败',
    },
    semanticTags: {
      title: '语义标签',
      empty: '还没有标签，右键点击文件并选择“管理标签”即可开始',
      insights: '工作室洞察',
      stats: {
        totalFiles: '文件总数',
        folders: '文件夹',
        uniqueTags: '唯一标签',
      },
    },
    explorerTree: {
      emptySearch: '未找到结果',
      emptyFilter: '没有项目匹配所选标签',
      emptyDefault: '还没有文件',
    },
    itemMenu: {
      rename: '重命名',
      manageTags: '管理标签',
      revealInFileManager: '在文件管理器中显示',
      remove: '移除',
    },
    tagDialog: {
      title: '管理标签',
      description: (name: string) => `${name} 的标签`,
      activeTags: '已启用的标签',
      noTags: '还没有标签',
      available: '可用',
      createNew: '创建新标签',
      placeholder: '标签名称...',
    },
  },
  settings: {
    title: '偏好设置',
    description: '定制你的创作圣地，这些设置可调整无限画布的视觉氛围与功能深度',
    canvasStyle: {
      title: '画布样式',
      eyebrow: '视觉外观',
      options: {
        grid: '网格',
        dots: '点阵',
        blank: '空白',
      },
    },
    language: {
      title: '语言',
      eyebrow: '界面语言',
    },
    pageFrameEditing: {
      title: '页面框编辑',
      eyebrow: '文档视图',
      fitWholePage: {
        label: '编辑时适配整页',
        description: '进入页面框编辑模式时缩小视图，显示完整页面高度。',
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
          label: 'Google Drive',
          description: '同步到你 Google Drive 中的专用文件夹',
        },
      },
      auth: {
        title: '仓库身份验证',
        descriptions: {
          polling: '在浏览器中输入代码以完成登录',
          connected: '已完成登录',
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
                : `${count} 项更改已在本地排队，直到恢复远程同步`,
          },
          issue: {
            label: '异常',
            onlineDescription: '仓库已配置，但上次同步尝试失败',
            offlineDescription: '远程同步不可用，本地仍可访问缓存数据',
          },
          synced: {
            label: '已同步',
            upToDate: '远程仓库已是最新',
            ready: '仓库已准备好同步',
          },
        },
      },
      fields: {
        owner: {
          select: '选择拥有者',
          loading: '正在加载账户...',
          error: '无法加载 GitHub 账户',
          you: '你',
          org: '组织',
        },
        repo: {
          pickOwner: '选择拥有者',
          select: '选择仓库',
          loading: '正在加载仓库...',
          error: '无法加载仓库',
          empty: '没有仓库',
        },
        branch: {
          pickRepo: '选择仓库',
          select: '选择分支',
          loading: '正在加载分支...',
          error: '无法加载分支',
          empty: '没有分支',
        },
      },
    },
    keybinds: {
      title: '快捷键',
      resetAll: '全部重置',
      pressKey: '按下一个键...',
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
          label: '插入页面框架',
          description: '在画布上放置新的页面框架',
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
  },
  canvas: {
    kind: '画布',
    statusBar: {
      fps: (fps: number) => `${fps} fps`,
    },
    toolbar: {
      clickForOptions: '点击查看选项',
      customizeWheel: '自定义轮盘',
      insert: '插入',
    },
    insert: {
      title: '插入',
      soon: '即将推出',
      frame: {
        label: '页面框架',
        description: '可书写的新页面',
      },
      embed: {
        label: '图片或 PDF',
        description: '拖入文件或粘贴链接',
      },
      link: {
        label: '笔记链接',
        description: '链接或嵌入其他笔记',
      },
    },
    toolShelf: {
      title: '工具盘',
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
      stroke: '笔画',
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
    },
    embedComposer: {
      dropToEmbed: '拖放以嵌入',
      title: '添加媒体',
      subtitle: '粘贴、拖放或选择图片及PDF',
      readyToEmbed: '准备嵌入',
      embedPdf: '嵌入 PDF',
      embedImage: '嵌入图片',
      urlPlaceholder: '粘贴 URL',
      fetch: '获取',
      browse: '点击浏览',
      dropFiles: '或将文件拖放到这里',
      pasteFromClipboard: '从剪贴板粘贴',
      embedded: '已嵌入',
      errors: {
        unsupportedUrl: '该链接指向的不是图片或 PDF',
        fetchFailed: '无法获取该链接',
        unsupportedType: '',
        unsupportedDesc: () => {
          throw new Error('not yet implemented language');
        },
      },
    },
    peerSync: {
      title: '协作同步',
      host: '使用 iroh 托管',
      joinPlaceholder: '输入共享代码',
      join: '加入',
      waitingForPeer: '等待对等方...',
      shareCode: '将此代码分享给协作方',
      connecting: '连接中...',
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
      peerModes: {
        'owner-device': '拥有者设备',
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
  debug: {
    uploadPdf: '上传 PDF',
    empty: '选择一个 PDF 进行渲染',
  },
  dialogs: {
    closeSrOnly: '关闭',
  },
};

export default zhHans;
