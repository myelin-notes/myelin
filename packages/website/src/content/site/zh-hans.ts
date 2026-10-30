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
    beta: '测试版',
    betaNote: 'Myelin Notes 目前处于测试阶段，价格方案可能会调整。',
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
    headline: '手写、打字与 PDF，都在同一则笔记',
    headlineMark: '都在同一则笔记',
    subheadline:
      'Myelin Notes 是一款原生、本地优先的笔记应用：在同一块画布上，笔迹、富文本、PDF、图片与音频共处一处。你的笔记留在自己的设备上，同时仍可与他人实时协作编辑，无需任何服务器。',
    trustLine: '个人使用免费 · 无需账号 · 你的笔记永不被付费墙锁住',
    ctaPrimary: '下载',
    ctaSecondary: '在浏览器中试用',
  },

  tryIt: {
    title: '在浏览器中试用 Myelin Notes',
    description:
      '一块 Myelin 画布，可直接在浏览器中绘画、书写和打字，内容保存在此浏览器中。下载应用即可使用全部功能。',
    badge: '网页版功能有限',
    limited:
      '这是功能有限的网页预览版。应用还提供笔记库、搜索、录音、PDF 导出和同步。',
  },

  ink: {
    pdfHeading: '直接在 PDF 上书写批注',
    pdfBody:
      '把 PDF 拖到画布上，用与其他内容相同的笔迹批注：圈出公式、高亮某一行、在页边随手涂写。完成后，可以把带批注的 PDF 导出。',
  },

  pages: {
    heading: '真正的文档，就在画布上',
    body: '页面框是完整的富文本文档：Markdown 快捷输入、标题、列表与复选框、表格、公式，以及代码块（升级 Pro 即可运行）。',
  },

  audioSearch: {
    heading: '录下来，转成文字。在画布上找得到',
    audioBody:
      '在画布上录下课堂或会议。内置的 Whisper base 模型在本地设备上完成转写，让你无需上传音频就能查找转写内容。Pro 提供更准确的模型。',
    searchBody:
      '在资料库中搜索笔记标题、标签、已保存文字和音频转写内容；也可以在打开的画布中查找。',
  },

  linked: {
    heading: '你的笔记，彼此相连',
    body: '[[笔记链接]]、反向链接与悬停预览卡片，让相关的想法始终只有一步之遥。命令面板带你跳转到任何位置，按文件保存的版本历史可以还原笔记的任一早期状态。',
  },

  importing: {
    heading: '把旧笔记一起带过来',
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
    heading: '一切都留在你自己的电脑上',
    lede: '中间没有任何云端。你的笔记就是自己硬盘上的普通文件，Myelin 完全可以离线使用。',
    bullets: [
      '你的笔记是硬盘上的普通文件，采用开放、无冲突的格式（Yjs）。任何内容都不会被锁定。',
      '所有功能都能完全离线使用，无需账号，中间也没有服务器。',
      '使用 Pro，即可自带 AI：模型通过本地 MCP 服务器接入，而不是我们替你选定的某个云服务。',
      '可从 Obsidian 或 GoodNotes 导入，导出为 PDF、图片或 JSON，并在 GitHub 上阅读每一行源码。',
    ],
  },

  sync: {
    heading: '同步与协作，中间没有服务器',
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

是的。免费版供个人使用，没有时间限制，几乎包含所有功能。Myelin Pro 为一次性购买，价格 49.99 美元，学生 29.99 美元，增加通过 MCP 连接的 AI 智能体、代码运行和更高的上限。你的笔记永不被付费墙锁住。

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

  features: {
    meta: {
      title: '功能 | Myelin Notes',
      description:
        'Myelin Notes 的全部功能：手写时自动规整的形状、直尺与笔预设，PDF 引用与锚定笔迹，支持 Mermaid 图表的页面，通过本地 MCP 连接的 AI 智能体，以及更多。',
    },
    eyebrow: '功能',
    headline: 'Myelin Notes 能做的一切',
    subheadline:
      '首页展示的是全貌，这里讲的是细节：手写、PDF、页面和画布上的各种工具，以及它们如何配合。',
    jumpNav: '章节',
    sections: {
      handwriting: {
        label: '手写',
        heading: '像真笔一样书写，还有纸上做不到的技巧',
        lede: '用触控笔、手指或鼠标书写。想要笔直的地方，Myelin 帮你拉直；你的字迹，仍然是你的字迹。',
        details: [
          '支持压感的笔，防抖强度可调，线条更稳',
          '防误触，以及决定手指用途的“手写笔”或“触摸”模式',
          '按下笔侧按钮切换到橡皮擦，可立即切换，也可在抬笔后切换',
          '整笔擦除的橡皮擦，或只擦触碰部分的精细橡皮擦',
          '矩形或套索选择，然后移动、复制、锁定或调整层级',
          '自定义颜色保存一次即可反复使用，文字可选用你喜欢的字体',
        ],
      },
      pdfs: {
        label: 'PDF',
        heading: '不只是阅读，更能在 PDF 里工作',
        lede: '在与其他笔记同一张画布上批注、引用和重新排列 PDF，完成后导出结果。',
        details: [
          '完成后导出带批注的 PDF',
          '用页面导航跳转到任意一页',
          'PDF 可按“页面”排列，也可按“分栏”并排显示',
          '为 PDF 页面插上旗标，方便回看',
          '用画布搜索查找 PDF 中的文字',
        ],
      },
      pages: {
        label: '页面',
        heading: '页面不只是用来放文字',
        lede: '页面框是画布上的富文本文档。输入 / 插入任何内容，或者直接用 Markdown 书写。',
        details: [
          '用 Markdown 快捷输入标题、列表、引用和格式',
          '待办清单、提示框和表格',
          '公式块，以及代码块（Pro 可运行）',
          '[[笔记链接]] 支持悬停预览，重命名笔记时自动更新',
          '嵌入图片、视频、YouTube 和链接卡片',
          '“页面”“分栏”或“连续”布局',
        ],
      },
      canvas: {
        label: '画布',
        heading: '一张无限画布，也不会让你迷路',
        lede: '页面、PDF、图片、音频和笔迹可以放在任何位置，按一个键就能回到任意地点。',
        details: [
          '图片可以裁剪、旋转、锁定，并锚定到页面',
          '用摄像头拍照，直接放到画布上',
          '画布上任意位置都能放 LaTeX 公式块',
          '浅色或深色主题，也可跟随系统',
          '在设置中重新绑定快捷键',
        ],
      },
      sync: {
        label: '实时同步',
        heading: '一起书写，没有服务器保管你的笔记',
        lede: '在两台设备上打开同一则笔记，它们会直接相连。你在一台上写下的内容，会在另一台上同步出现。',
        details: [
          '打开同一则笔记的设备会自动找到彼此',
          '编辑内容通过端到端加密的 QUIC 连接（iroh）传输',
          '两台设备都需要能访问同一个 GitHub 同步仓库',
          '无需 Myelin 账号',
        ],
      },
      agents: {
        label: 'AI 智能体',
        heading: '用你自己的 AI，在你自己的电脑上',
        lede: 'Myelin 没有内置聊天机器人，而是运行一个本地 MCP 服务器，让你已经在用的 AI 应用读取你的笔记，并在你允许时写入。AI 智能体属于 Myelin Pro 功能。',
        details: [
          '服务器只监听 127.0.0.1，端口由你选择',
          '从设置中复制安装提示，即可连接你的智能体',
          '智能体可以读取笔记、链接、页面、PDF、图片、手写内容和画布截图',
          '在设置中开启“允许直接 MCP 写入”之前，写入始终关闭',
          '开启写入后，智能体可以创建笔记、页面、LaTeX 和笔迹，并编辑标签',
        ],
      },
      connect: {
        label: '查找与关联',
        heading: '你写下的一切，都找得到',
        lede: '音频、搜索和链接把笔记串在一起，上个月的想法也只需敲几下键盘。',
      },
      more: {
        label: '更多',
        heading: '你的文件，你的同步，你的语言',
        lede: '基础能力，一览无余。',
        details: [
          '笔记是你磁盘上的普通文件，采用开放格式（Yjs）',
          '完全离线可用，无需账号',
          '通过你掌控的 GitHub 仓库在设备间同步',
          '从 Goodnotes、OneNote、Obsidian、Notion、Markdown 和 PDF 导入',
          '导出为 PDF、Markdown、Obsidian 仓库或工作区 JSON',
          '支持英语、西班牙语、法语和简体中文',
        ],
      },
    },
    clips: {
      shapes: {
        title: '形状自动规整',
        body: '随手画出矩形、椭圆、三角形或直线，然后让笔停住不动，它就会变成规整的形状。',
        alt: '用笔随手画出的形状在笔停住后变成规整的形状',
      },
      toolWheel: {
        title: '工具轮盘与笔预设',
        body: '右键单击，就在书写的位置打开工具和已保存笔的轮盘，不必再去工具栏。',
        alt: '工具轮盘在光标处打开，从中选取一支已保存的笔',
      },
      ruler: {
        title: '直尺',
        body: '打开直尺，拖动旋钮调到任意角度，沿着边缘画出笔直的线。',
        alt: '直尺转到 30 度，沿边缘画出的抖动笔画变得笔直',
      },
      lasso: {
        title: '写完再整理',
        body: '用套索圈住一段手写内容，拖到合适的位置，或拖动角点调整大小。选中单个手绘，用上方的手柄即可旋转。',
        alt: '用套索圈住手写内容，拖到标题下方并从角上缩小，再把箭头转向它',
      },
      pdfQuote: {
        title: '引用 PDF 内容',
        body: '在 PDF 中选中文字，选择“引用”，再点一下页面即可放入，并附带指回原处的链接。',
        alt: '在 PDF 中选中的一句话被引用到笔记里，成为链接回 PDF 的引用块',
      },
      pdfAnchor: {
        title: '笔记留在页面上',
        body: '写在 PDF 某一页上的内容会附着在那一页。移动 PDF 或更改版式时，笔记仍留在页面上原来的位置。用“锚定到页面”也可以这样固定图片和形状。',
        alt: '圈出并批注 PDF 第 2 页的公式，然后 PDF 切换为分栏，笔迹随所在页面移动',
      },
      slash: {
        title: '用 / 插入任何内容',
        body: '在页面中输入 /，即可插入标题、表格、提示框、公式和代码。mermaid 代码块会绘制成图表，“嵌入”可把链接变成视频或链接卡片。',
        alt: '通过 / 菜单插入代码块，其中的 mermaid 流程图渲染为图表，随后通过“嵌入”把 YouTube 链接变成视频卡片',
      },
      imageAnchor: {
        title: '图片随文字移动',
        body: '把图片锚定到页面，文字会为它让出位置。在上方输入文字时，图片会随之下移。',
        alt: '页面中的照片被锚定，文字为它让出位置，在上方输入时照片随之下移',
      },
      canvasStyle: {
        title: '每个画布都有自己的样式',
        body: '选择网格、点阵、横线，或使用 Pro 设置你自己的图片，并设置颜色。每个画布可以单独设置，默认样式在设置中调整。',
        alt: '画布样式面板把背景改为横线，并选择暖色的纸张颜色',
      },
      flags: {
        title: '插上旗标，随时回看',
        body: '用旗标工具（B）插上旗标，选择“待办”“待复查”等类型，或自建类型。在画布上的旗标之间跳转，或打开“旗标”页面，在所有笔记中按类型筛选。',
        alt: '为一个标题插上待办旗标、为一页 PDF 插上待复查旗标，旗标列表跳转到 PDF，然后旗标页面筛选出所有笔记中的待复查旗标',
      },
      liveCollab: {
        title: '实时协作',
        body: '你画下的笔迹会一笔一笔出现在另一块屏幕上，输入的文字也会逐字出现，双向同步。',
        alt: '在 Mac 上写下的笔迹随书写同步出现在 Ada 的电脑上，随后 Ada 输入的待办事项逐字出现在 Mac 上',
      },
      agents: {
        title: '你的 AI 应用，与 Myelin 对话',
        body: '画面中的聊天窗口代表你使用的任意 AI 应用，它不属于 Myelin。它通过你电脑上的 MCP 读取你的手写笔记，并在画布上添加一页打字整理的摘要。',
        alt: '一个独立的 AI 应用通过 MCP 读取 Myelin 中的手写笔记，并在旁边添加一页打字摘要',
      },
    },
    notes: [
      {
        title: '录音',
        body: '直接在画布上录下课堂或会议，或导入语音备忘录。',
      },
      {
        title: '本地转写',
        body: '内置的 Whisper 模型在你的电脑上完成转写。点按任意一行的时间戳，即可从那里开始播放。',
      },
      {
        title: '搜索',
        body: '按标题、标签、已保存的文字或转写内容搜索资料库，也能在打开的画布中查找任意字词。',
      },
      {
        title: '链接与反向链接',
        body: '用 [[双中括号]] 链接笔记，查看所有反向链接，悬停在链接上即可预览笔记。',
      },
      {
        title: '关系图谱',
        body: '查看笔记之间如何相互链接，并从图谱中打开任意一篇。',
      },
      {
        title: '多级标签',
        body: '为笔记添加标签，把标签嵌套在其他标签之下，并按任意标签筛选资料库。',
      },
      {
        title: '命令面板',
        body: '不离开键盘，就能打开笔记、新建笔记或打开关系图谱。',
      },
      {
        title: '版本历史',
        body: '每篇笔记都保留之前的版本，任何一个版本都能一键还原。',
      },
    ],
    closing: {
      heading: '亲自试试吧',
      body: '个人使用完全免费，无需账号。下载应用，或先在浏览器中试用画布。',
    },
  },

  pricing: {
    meta: {
      title: '价格 | Myelin Notes',
      description:
        'Myelin Notes 个人使用免费。Myelin Pro 为一次性购买，价格 49.99 美元，学生 29.99 美元，提供通过 MCP 连接的 AI 智能体、代码运行和更高的上限。',
    },
    eyebrow: '价格',
    headline: '免费使用，需要更多时再升级 Pro',
    subheadline:
      '免费版几乎包含所有功能。Pro 为一次性购买，解锁其余功能，同时支持 Myelin 的开发。',
    free: {
      name: '免费版',
      price: '0 美元',
      tagline: '供个人使用，没有时间限制。',
      includesLabel: '包含',
      includes: [
        '手写、PDF、页面与无限画布',
        '录音及设备端转写',
        'GitHub 同步与实时协作',
        '导入、导出、搜索与链接',
        '最多 6 个自定义笔预设',
        '2 种旗标类型',
      ],
      cta: '下载',
    },
    pro: {
      name: 'Pro',
      price: '49.99 美元',
      priceNote: '一次性购买',
      tagline: '一次付费，无需订阅。',
      includesLabel: '包含免费版全部功能，另加',
      includes: [
        '通过本地 MCP 服务器连接 AI 智能体',
        '在页面中运行代码块',
        '不限数量的旗标类型',
        '不限数量的自定义笔预设',
        '使用你自己的图片作为画布背景',
        '更准确的转写模型',
        '支持 Myelin 的开发',
      ],
      cta: '购买 Pro',
      licenseNote:
        '许可证密钥会通过邮件发送给你，可在最多 3 台设备上解锁 Pro。',
    },
    student: {
      price: '学生价 29.99 美元。',
      note: '输入你的学校邮箱，我们会把学生价购买链接发送给你。',
      emailLabel: '学校邮箱',
      submit: '发送链接',
      sending: '正在发送…',
      sent: '请查看收件箱，学生价购买链接已发送。',
      notAcademic:
        '我们无法识别该学校邮箱。如果你的学校不在列表中，请联系支持。',
      failed: '链接发送失败，请重试。',
    },
    faqTitle: '价格常见问题',
    faqs: [
      {
        question: '如何解锁 Pro？',
        answer:
          '购买 Pro 后，你会通过邮件收到许可证密钥。在 Myelin 应用中输入密钥，即可在该设备上解锁 Pro。',
      },
      {
        question: '可以在几台设备上使用？',
        answer: '一个许可证密钥最多可在 3 台设备上解锁 Pro。',
      },
      {
        question: '这是订阅吗？',
        answer: '不是。Pro 为一次性购买。',
      },
      {
        question: '学生价如何申请？',
        answer:
          '在本页输入你的学校邮箱。如果该邮箱属于已收录的学校，我们会发给你以 29.99 美元购买 Pro 的链接。链接 24 小时内有效。',
      },
      {
        question: '如果一直使用免费版，我的笔记会怎样？',
        answer:
          '不会怎样。你的笔记是磁盘上的普通文件，免费版可以打开全部笔记。',
      },
    ],
  },

  linkLabels: {
    features: '功能',
    pricing: '价格',
    privacy: '隐私政策',
    support: '支持',
  },

  footer: {
    nav: '页脚',
    tagline: '手写、打字与 PDF，都在同一则笔记。',
    platforms: 'Mac · Windows · Linux · iPhone、iPad 与 Android 即将推出',
  },

  shots: {
    hero: '同一画布上的 PDF 和键入的页面框：笔圈出一个公式，画一支箭头指向笔记，笔记里输入一行文字，并手写下“key result!”',
    pdf: '一份 PDF，其中一句话被高亮、一行被划线、页边写下“E = mc²!”，随后导出带批注的 PDF',
    pageFrame:
      '一个带有待办清单和 TypeScript 代码块的页面框，代码块运行后在旁边显示输出',
    audio: '画布上的一段音频，经过录制、转写，然后通过搜索“entropy”找到',
    graph: 'Myelin Notes 的关系图谱视图，显示某则笔记的出链与反向链接',
  },

  canvas: {
    addCustomColor: '添加自定义颜色（十六进制，例如 #3b82f6）',
  },
};

export default zhHans;
