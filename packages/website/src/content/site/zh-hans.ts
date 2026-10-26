import type { SiteCopy } from './index';

/**
 * Simplified Chinese site copy. Terminology follows the app's own catalog
 * (`@myelin/editor/i18n/messages/zh-Hans`): 画布, 笔记, 页面框, 资料库.
 */
const zhHans: SiteCopy = {
  meta: {
    title: 'Myelin Notes：手写、输入与 PDF 合一的本地优先笔记应用',
    description:
      'Myelin Notes 是一款原生、本地优先的笔记应用，支持 Mac、Windows 与 Linux，iPhone、iPad 与 Android 版本即将推出：在同一块画布上，手写、文字、PDF、图片与音频共处于一则笔记中，全部保存在你自己的设备上。个人使用完全免费。',
  },

  topbar: {
    nav: '站点',
    download: '下载',
    language: '语言',
  },

  sceneLabels: {
    ink: 'PDF',
    pages: '页面',
    'audio-search': '音频与搜索',
    linked: '笔记链接',
    sync: '同步与协作',
    'local-first': '本地优先',
    import: '导入',
    download: '下载',
  },
  faqKicker: '常见问题',

  hero: {
    eyebrow: 'Myelin Notes · 本地优先的笔记应用',
    headline: '手写、打字与 PDF，都在同一则笔记。',
    headlineMark: '都在同一则笔记。',
    subheadline:
      'Myelin Notes 是一款原生、本地优先的笔记应用：在同一块画布上，笔迹、富文本、PDF、图片与音频共处一处。你的笔记留在自己的设备上，同时仍可与他人实时协作编辑，无需任何服务器。',
    trustLine: '个人使用完全免费 · 无需账号 · 你的笔记永不被付费墙锁住',
    ctaPrimary: '下载',
    ctaSecondary: '在浏览器中试用',
  },

  tryIt: {
    title: '在浏览器中试用 Myelin Notes',
    description:
      '一块空白的 Myelin 画布，可直接在浏览器中绘画、书写和打字。内容不会保存：下载应用即可保留你的笔记。',
  },

  ink: {
    pdfHeading: '直接在 PDF 上书写批注。',
    pdfBody:
      '把 PDF 拖到画布上，用与其他内容相同的笔迹批注：圈出公式、高亮某一行、在页边随手涂写。完成后，可以把带批注的 PDF 导出。',
  },

  pages: {
    heading: '真正的文档，就在画布上。',
    body: '页面框是完整的富文本文档：Markdown 快捷输入、标题、列表与复选框、表格、公式，以及可以直接运行的代码块。',
  },

  audioSearch: {
    heading: '录下来，转成文字。在画布上找得到。',
    audioBody:
      '在画布上录下课堂或会议。内置的 Whisper base 模型在本地设备上完成转写，让你无需上传音频就能查找转写内容。',
    searchBody:
      '在资料库中搜索笔记标题、标签、已保存文字和音频转写内容；也可以在打开的画布中查找。',
  },

  linked: {
    heading: '你的笔记，彼此相连。',
    body: '[[笔记链接]]、反向链接与悬停预览卡片，让相关的想法始终只有一步之遥。命令面板带你跳转到任何位置，按文件保存的版本历史可以还原笔记的任一早期状态。',
  },

  importing: {
    heading: '把旧笔记一起带过来。',
    body: '从其他应用导入你的笔记',
    sources: [
      {
        id: 'goodnotes',
        label: '从 Goodnotes 导入',
        detail: '把 Goodnotes 的内容导出为 PDF 压缩包后导入。',
      },
      {
        id: 'onenote',
        label: '从 OneNote 导入',
        detail: '从 .onepkg 笔记本或 .one 分区导入 OneNote 的内容。',
      },
      {
        id: 'obsidian',
        label: '从 Obsidian 导入',
        detail: '直接从 vault 文件夹导入 Obsidian 的内容。',
      },
      {
        id: 'notion',
        label: '从 Notion 导入',
        detail: '把 Notion 的内容导出为 Markdown 与 CSV 后导入。',
      },
    ],
  },

  localFirst: {
    heading: '一切都留在你自己的电脑上。',
    lede: '中间没有任何云端。你的笔记就是自己硬盘上的普通文件，Myelin 完全可以离线使用。',
    bullets: [
      '你的笔记是硬盘上的普通文件，采用开放、无冲突的格式（Yjs）。任何内容都不会被锁定。',
      '所有功能都能完全离线使用，无需账号，中间也没有服务器。',
      '自带 AI：模型通过本地 MCP 服务器接入，而不是我们替你选定的某个云服务。',
      '可从 Obsidian 或 GoodNotes 导入，导出为 PDF、图片或 JSON，并在 GitHub 上阅读每一行源码。',
    ],
  },

  sync: {
    heading: '同步与协作，中间没有服务器。',
    kicker:
      '实时协作编辑通常意味着由服务器保管你的笔记。Myelin 选择让设备之间直接连接。',
    tiers: [
      {
        badge: '现已支持',
        live: true,
        title: '实时协作',
        body: '打开同一则笔记的两台设备会自动找到彼此，随后通过两端之间直连的加密 QUIC 连接（iroh）同步编辑。',
      },
      {
        badge: '现已支持',
        live: true,
        title: 'GitHub 同步',
        body: '为 Myelin 指定一个仓库和分支，你的工作区就会通过这个由你掌控的仓库在各设备间同步。',
      },
      {
        badge: '即将推出',
        title: '邀请协作',
        body: '无需交出整个仓库，就能邀请他人加入单则笔记，并以所有者、编辑者和查看者的角色决定对方可以做什么。',
      },
    ],
  },

  download: {
    body: '提供简体中文、英文、西班牙文与法文版本。',
    cta: '下载 Myelin Notes',
    platforms: [
      {
        key: 'mac',
        name: 'macOS',
        label: '下载 macOS 版',
        sub: 'macOS 10.15 及以上',
      },
      {
        key: 'windows',
        name: 'Windows',
        label: '下载 Windows 版',
        sub: 'Windows 10 及以上',
      },
      {
        key: 'linux',
        name: 'Linux',
        label: '下载 Linux 版',
        sub: 'AppImage',
      },
      {
        key: 'ios',
        name: 'iOS',
        label: '下载 iOS 版',
        sub: 'iPhone 与 iPad',
      },
      {
        key: 'android',
        name: 'Android',
        label: '下载 Android 版',
        sub: '手机与平板',
      },
    ],
    comingSoon: '即将推出',
    mobileBadge:
      'iPhone、iPad 与 Android 版本正在开发中：同样的笔记，而不是功能缩水的阅读器',
    faqTitle: '常见问题',
    faqMarkdown: `# 常见问题

## 真的免费吗？

是的，个人使用完全免费。

## 我的笔记保存在哪里？

保存在本地，就是你设备上的文件。如果你希望笔记放在自己掌控的仓库里，可以选择开启 GitHub 同步。

## 需要注册账号吗？

不需要。Myelin Notes 完全没有账号系统：下载、打开，笔记就在你的硬盘上。只有在开启 GitHub 同步时才需要用 GitHub 登录，而那是你与 GitHub 之间的账号，不是与我们之间的。

## 它是开源的吗？

并不完全是。源码是公开的，任何人都可以阅读，核实这个应用如何处理笔记；个人使用及其他非商业用途均免费。它采用 PolyForm Strict 1.0.0 许可，也就是说你不能再分发它，也不能发布修改版本，商业用途需要另行取得许可。

## 可以和别人协作吗？

可以，现在就支持点对点的实时协作。没有 Myelin 账号，中间也没有任何服务。设备之间通过 GitHub 同步互相发现，因此双方都需要能访问同一个仓库。带权限管理的共享笔记本将在 v1.0 推出。

## 可以从别的应用导入吗？

可以。Myelin 支持导入 Obsidian vault、OneNote 的 .onepkg 笔记本或 .one 分区、导出为 PDF 的 Goodnotes 文件夹，以及零散的 Markdown、PDF、图片与视频，还有从 Myelin 自身导出的工作区文件夹。Notion 的内容可以通过它自己的 Markdown 与 CSV 导出导入，由文件导入器读取；能保留页面层级的专用 Notion 导入器已列入计划。

## 离线能用吗？

完全可以。编辑、全文与语义搜索、手写识别、音频转写、PDF 批注以及导出，全部在你自己的设备上运行，因此断网后应用的表现完全一致。只有 GitHub 同步和实时协作需要网络，而这两项都是可选的。

## iPhone、iPad 和 Android 上如何？

即将推出。目前 Myelin Notes 支持 Mac、Windows 与 Linux。移动版正在开发中，并且会是原生应用而不是功能缩水的阅读器：笔记、画布和同步都与桌面版一致，iPad 上支持 Apple Pencil，Android 上支持 S Pen 或主动式触控笔。
`,
  },

  linkLabels: {
    privacy: '隐私政策',
    support: '支持',
  },

  footer: {
    nav: '页脚',
    tagline: '手写、打字与 PDF，都在同一则笔记。',
    platforms: 'Mac · Windows · Linux · iPhone、iPad 与 Android 即将推出',
  },

  shots: {
    pdf: '嵌入 Myelin 画布的 PDF，一个公式被框出，旁边还有一支手绘的箭头',
    pageFrame:
      'Myelin 的页面框，包含标题、笔记链接、待办清单、行内公式，以及正在运行并在旁边显示输出的代码块',
    audio: 'Myelin 画布上的一段录音，波形随录制过程实时绘制',
    graph: 'Myelin Notes 的关系图谱视图，显示某则笔记的出链与反向链接',
  },

  canvas: {
    addCustomColor: '添加自定义颜色（十六进制，例如 #3b82f6）',
  },
};

export default zhHans;
