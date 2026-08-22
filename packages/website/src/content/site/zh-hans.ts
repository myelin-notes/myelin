import type { SiteCopy } from './index';

/**
 * Simplified Chinese site copy. Terminology follows the app's own catalog
 * (`@myelin/editor/i18n/messages/zh-Hans`): 画布, 笔记, 页面框, 资料库.
 *
 * Headlines are deliberately short: CJK glyphs are about one em wide, so a line
 * that reads compactly here is far wider on the canvas than its English
 * counterpart at the same character count.
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
    hero: 'Myelin',
    ink: 'PDF',
    pages: '页面',
    'audio-search': '音频与搜索',
    linked: '笔记链接',
    sync: '同步与协作',
    'local-first': '本地优先',
    download: '下载',
  },
  faqKicker: '常见问题',

  hero: {
    eyebrow: 'Myelin Notes · 本地优先的笔记应用',
    headline: '手写、打字与 PDF，\n都在同一则笔记。',
    subheadline:
      'Myelin Notes 是一款原生、本地优先的笔记应用：在同一块画布上，笔迹、富文本、PDF、图片与音频共处一处。你的笔记留在自己的设备上，同时仍可与他人实时协作编辑，无需任何服务器。',
    trustLine: '个人使用完全免费 · 无需账号 · 你的笔记永不被付费墙锁住',
    ctaPrimary: '下载',
    ctaSecondary: '看看实际效果',
  },

  ink: {
    annotation: '画个形状并按住，试试看！',
    recognized: '识别成功！',
    pdfHeading: '直接在 PDF 上\n书写批注。',
    pdfBody:
      '把 PDF 拖到画布上，用与其他内容相同的笔迹批注：圈出公式、高亮某一行、在页边随手涂写。完成后，可以把带批注的 PDF 导出。',
    pdfAnnotation: '笔迹直接落在页面上',
  },

  pages: {
    heading: '真正的文档，\n就在画布上。',
    body: '页面框是完整的富文本文档：Markdown 快捷输入、标题、列表与复选框、表格、公式，以及可在笔记中直接运行的代码块，支持九种语言。Python、JavaScript、TypeScript、Ruby、Bash、Go、Rust、C 和 C++。',
    annotation: '一个真正可编辑的页面，点进去看看。',
    pageTitle: '第 12 讲 · 动作电位',
    pageMarkdown: `# 动作电位

神经元的静息电位约为 **-70 mV**，由钠钾泵维持。

## 今日内容

- [x] 静息电位回顾
- [ ] 去极化与 Na+ 通道级联
- [ ] 髓鞘为何能加快传导

| 阶段 | 通道 | 方向 |
| --- | --- | --- |
| 去极化 | Na+ 开放 | 内流 |
| 复极化 | K+ 开放 | 外流 |

膜电位遵循下式：

$$V_m = \\frac{RT}{F} \\ln \\frac{[K^+]_{out}}{[K^+]_{in}}$$

\`\`\`python
tau = 2.0  # 膜时间常数，单位 ms
v = -70.0
for step in range(3):
    v += (0 - v) / tau
    print(round(v, 1))
\`\`\`
`,
  },

  audioSearch: {
    heading: '录下来，找得到。\n连手写也不例外。',
    audioBody:
      '在画布上录下课堂或会议。内置的 Whisper base 模型在本地设备上完成转写，因此每段录音都可搜索，而音频始终不会离开你的设备。',
    searchBody:
      '全文搜索与语义搜索都在本地运行，使用内置的 all-MiniLM-L6-v2 模型。在 macOS 上，手写内容通过 Apple 的 Vision 框架识别，音频转写文本同样可以搜索。',
    audioMock: {
      title: '第 12 讲 · 动作电位',
      duration: '48:12',
      transcriptLabel: '转写文本 · 本地生成',
      transcript:
        '……髓鞘包裹着轴突，因此信号在结与结之间跳跃传导，而不是缓慢爬行……',
      match: '髓鞘',
    },
    searchMock: {
      query: '郎飞结',
      results: [
        {
          kind: 'page',
          title: '第 12 讲 · 动作电位',
          snippet: '……信号在郎飞结之间跳跃……',
        },
        {
          kind: 'ink',
          title: '白板 · 髓鞘化草图',
          snippet: '手写匹配，本地 OCR',
        },
        {
          kind: 'audio',
          title: '录音 · 第 12 讲',
          snippet: '转写文本匹配，位于 31:42',
        },
      ],
    },
  },

  linked: {
    heading: '你的笔记，彼此相连。',
    body: '[[笔记链接]]、反向链接与悬停预览卡片，让相关的想法始终只有一步之遥。命令面板带你跳转到任何位置，按文件保存的版本历史可以还原笔记的任一早期状态。',
  },

  localFirst: {
    heading: '一切都留在\n你自己的电脑上。',
    lede: '中间没有任何云端。你的笔记就是自己硬盘上的普通文件，Myelin 完全可以离线使用。',
    bullets: [
      '你的笔记是硬盘上的普通文件，采用开放、无冲突的格式（Yjs）。任何内容都不会被锁定。',
      '所有功能都能完全离线使用，无需账号，中间也没有服务器。',
      '搜索、语义向量与手写 OCR（macOS）全部在你自己的设备上运行。',
      '自带 AI：模型通过本地 MCP 服务器接入，而不是我们替你选定的某个云服务。',
      '可从 Obsidian 或 GoodNotes 导入，导出为 PDF、图片或 JSON，并在 GitHub 上阅读每一行源码。',
    ],
  },

  sync: {
    heading: '同步与协作，\n中间没有服务器。',
    kicker:
      '实时协作编辑通常意味着由服务器保管你的笔记。Myelin 选择让设备之间直接连接。',
    cursorYou: '你',
    cursorPeer: 'ada',
    sharedNote: '同一则笔记，\n两台设备',
    tiers: [
      {
        shipped: true,
        badge: '现已支持',
        title: '实时协作',
        body: '打开同一则笔记的两台设备会自动找到彼此，随后通过两端之间直连的加密 QUIC 连接（iroh）同步编辑。',
      },
      {
        shipped: true,
        badge: '现已支持',
        title: 'GitHub 同步',
        body: '为 Myelin 指定一个仓库和分支，你的工作区就会通过这个由你掌控的仓库在各设备间同步。',
      },
      {
        shipped: false,
        badge: '即将推出',
        title: '邀请协作',
        body: '无需交出整个仓库，就能邀请他人加入单则笔记，并以所有者、编辑者和查看者的角色决定对方可以做什么。',
      },
    ],
  },

  download: {
    heading: '下载',
    body: '提供简体中文、英文与西班牙文版本。',
    cta: '下载 Myelin Notes',
    autoUpdates: '支持\n自动更新',
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
    otherPlatforms: '同时支持',
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

## 可以从 Obsidian 或 GoodNotes 导入吗？

两者都可以。Notion 导入功能已列入计划。

## 离线能用吗？

完全可以。编辑、全文与语义搜索、手写识别、音频转写、PDF 批注以及导出，全部在你自己的设备上运行，因此断网后应用的表现完全一致。只有 GitHub 同步和实时协作需要网络，而这两项都是可选的。

## iPhone、iPad 和 Android 上如何？

即将推出。目前 Myelin Notes 支持 Mac、Windows 与 Linux。移动版正在开发中，并且会是原生应用而不是功能缩水的阅读器：笔记、画布和同步都与桌面版一致，iPad 上支持 Apple Pencil，Android 上支持 S Pen 或主动式触控笔。
`,
  },

  linkLabels: {
    privacy: '隐私政策',
  },

  footer: {
    nav: '页脚',
    tagline: '手写、打字与 PDF，都在同一则笔记。',
    download: '下载 Myelin',
    platforms: 'Mac · Windows · Linux · iPhone、iPad 与 Android 即将推出',
  },

  shots: {
    library: 'Myelin Notes 的资料库，包含文件夹、笔记卡片、标签与搜索',
    pdf: '嵌入 Myelin 画布的 PDF，一个公式被框出，旁边还有一支手绘的箭头',
    pageFrame:
      'Myelin 的页面框，包含标题、笔记链接、待办清单、行内公式，以及正在运行并在旁边显示输出的代码块',
    audio: 'Myelin 画布上的一段录音，波形随录制过程实时绘制',
    graph: 'Myelin Notes 的关系图谱视图，显示某则笔记的出链与反向链接',
  },

  canvas: {
    rail: {
      label: '章节',
      previous: '上一节',
      next: '下一节',
      scrollHint: '滚动浏览',
    },
    palette: {
      label: '命令面板',
      placeholder: '跳转到笔记本的任何位置',
      empty: '没有匹配项。试试场景名称或“下载”。',
      groupGoTo: '跳转到',
      groupGetIt: '获取',
      download: '下载 Myelin Notes',
    },
    addCustomColor: '添加自定义颜色（十六进制，例如 #3b82f6）',
  },

  decorations: {
    heroUnderline: { dx: 4, dy: 290, width: 620 },
    localFirstHighlight: { dx: 0, dy: 292, width: 408 },
    syncUnderline: { dx: 0, dy: 310, width: 480 },
  },
};

export default zhHans;
