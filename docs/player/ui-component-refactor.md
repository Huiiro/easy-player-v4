# UI 组件规范与重构记录

更新：2026-10-22。

## 层级与职责

- `styles/theme.css`、`motion.css`：主题语义、全局动效参数。
- `styles/components.css`：已有公开主题类和材料，保持兼容。
- `styles/controls.css`：控件尺寸、焦点、禁用态、浮层和反馈的公共规范。
- `components/ui`：通用交互和展示，不读取播放器 Store、不调用业务 IPC。
- `components/<feature>`：业务组合及对应 composables。
- `services`：查询、IPC 和数据转换；通过参数接收搜索、筛选、偏好等上下文。
- `views`：页面状态、模块编排和路由，不重复实现底层控件。

只在职责可独立变化或具备复用场景时拆分。保留歌词时钟、虚拟列表、播放引擎和背景渲染的既有性能设计。

## 基础组件规范

### 尺寸与扩展入口

`ControlSize = 'xs' | 'sm' | 'md' | 'lg'`。Button、Input、Select 使用相同高度档位；Switch、Slider 使用相同尺寸名称，但保留各自适合的轨道几何。

| 接口                      | 职责                                                    |
| ------------------------- | ------------------------------------------------------- |
| Props                     | 状态、行为、位置、常用外观                              |
| Slots                     | 内容、图标、自定义选项、空状态、页脚                    |
| `--ep-*`、公开 `.ep-*` 类 | 材料和视觉定制，继续兼容主题包                          |
| 原生属性和事件            | 优先透传到实际交互元素；组合容器的 class/style 留在容器 |

Button 支持 `loading`、`iconOnly`；纯图标按钮由调用方提供 `aria-label`。Input 支持 `readonly`、`invalid`、`size`，暴露 `focus/blur`；禁用和只读状态禁止清空，数值 `0` 也可清空。标签、校验文案和业务提交由调用方负责。

Dialog 的 `width` 接受 CSS 尺寸或数字像素；旧的 `max-w-* / w-*` 类参数继续兼容。Drawer 的 `width/height` 接受 CSS 尺寸或数字像素。浮层 `width` 的旧工具类参数继续保留，避免一次迁移破坏调用方。

Dialog/Drawer 支持 `panelClass/bodyClass/headerClass`，以及 `afterEnter/afterLeave`。默认内容和 footer 插槽提供 `close`。原有 header/close 插槽保持兼容。

### 事件与状态

- `update:modelValue` 表示模型更新。
- Slider 的 `change` 表示键盘、刻度点击或拖动完成后的提交，值与模型处于同一变换空间；取消指针不提交。Slider 支持刻度、垂直布局、值变换。
- Range 保留原生 `input/change` DOM 事件，额外支持 `v-model`；旧 `value + @input` 调用不变。适合播放进度等轻量高频场景。
- Select、Switch、ColorPicker 的 `change` 表示一次选择变化。
- ConfirmDialog 原有 `confirm` 是完成通知。需要等待异步结果时使用 `confirmAction`，不要依赖 Vue 事件返回 Promise。失败时保持打开并发出 `error`；处理中禁止重复确认和关闭。

### 浮层与关闭

Menu、Select、ColorPicker、Popover 共用 `FloatingPanel` 的定位、翻转、视口约束及滚动/尺寸监听。默认保留本地渲染，`teleport` 可避免父容器裁剪。弹层实际内容尺寸变化时会重新测量；监听和待执行帧在关闭、失活或销毁时清理。

Menu、Select、ColorPicker 继续使用 Headless UI 提供的语义和键盘能力。Popover 支持 click/hover、offset、四方向、show/hide、外部点击和 Esc；trigger 插槽提供 open/close，组件暴露 show/hide。触发插槽建议放展示内容，避免嵌套额外可交互按钮。

Dialog/Drawer 共用 `useModalClose`：Esc 与遮罩关闭分别由 `closeOnEsc/closeOnOverlay` 控制。内部选择器等控件可先消费 Esc，避免一次按键同时关闭多层。焦点管理、滚动锁定和 Portal 生命周期继续交给 Headless UI。

### 消息与颜色

`useMessage()` 提供只读消息列表、add/remove/clear/configure。默认最多 5 条，可配置 `max`，`dedupeKey` 显式去重；移除时清理定时器，onClose 只执行一次。`BaseMessage` 只在应用根部挂载一次，可选择 top/bottom。

颜色转换独立在 `ui/color.ts`。非法 Hex 输入恢复原值；透明度保留；补充可聚焦的色相、饱和度、明度及透明度原生滑块。Skeleton 使用主题颜色变量，`animated=false` 可单独关闭脉冲。

## 页面切换

`components/layout/AppPageOutlet.vue` 统一 RouterView、Transition 和 KeepAlive。

- 默认 slide，组件 prop 或 `route.meta.transition` 可选 `none/fade/slide`。
- 页面身份由路由名称、params、详情名称/歌手 query 决定；普通搜索 query 不重新挂载页面。
- 特殊页面可通过 `getPageKey(route)` prop 自定义页面身份，避免把业务身份规则写进基础组件。
- 缓存容器保持稳定，默认最多 3 页；`keepAlive=false` 页面不会清空其他已缓存页面。
- 每页使用真实 DOM 容器，支持多根节点页面和独立滚动位置。
- 仅内容区过渡，底栏与背景继续运行。沿用全局 reduce-motion 和系统减少动态效果规则。
- 迷你播放器、桌面歌词及独立窗口保留各自生命周期。播放器面板展开使用原有过渡。

## 本次实施清单

- [x] 14 个基础控件的公共接口、类型、主题反馈及公共导出。
- [x] Input 禁用清除、Slider 变换事件/陈旧值、Popover 无效 API、Menu 模板副作用等问题。
- [x] 共享浮层定位、观察实际尺寸、键盘打开、传送定位及关闭清理。
- [x] 弹窗关闭策略、尺寸兼容、区域定制、异步确认和消息计时清理。
- [x] 页面过渡、稳定缓存、片段页面容器及滚动状态。
- [x] SettingRow/SettingCard；14 个设置模块迁移重复结构。
- [x] SongListView 的选择状态拆为 useSongSelection，数据查询拆为 songListQuery。
- [x] 底栏自动隐藏拆为 useFooterAutoHide，歌词来源加载拆为 lyricSourceOptions；异步结果防止跨歌曲误用。
- [x] 播放器节奏采样拆为 usePlayerRhythm；封面分析、背景选择、对比度及图片加载生命周期拆为 usePlayerBackdrop。
- [x] AudioControlPanelV2 的 EQ 撤销、重做、比较、提交及清理拆为 useEqEditor。
- [x] 音乐库查询/数据映射拆为 libraryBrowser，封面卡片拆为 LibraryItemCard，滚动状态拆为 useScrollPosition。
- [x] 卡片模式数据加载和歌单切换拆为 useCardLibrary，防止过期请求覆盖当前集合。
- [x] 核实旧 AudioControlPanel.vue 没有生产入口引用；生产继续使用 V2。本次保留旧文件，避免将清理历史实现与交互重构混在一起。

## 第二轮：业务功能拆分与 Select 调用兼容

- [x] Select 宽度修复：外层继续接收 `class/style`，内部锚点和原生按钮撑满外层；长文本允许截断，不反向撑开 Flex 布局。修复固定宽度、百分比、`w-full` 和 `flex-1` 的实际触发框宽度，保持下拉面板等宽。
- [x] `SongListActions.vue` 负责歌曲上下文菜单和业务弹窗编排，`useSongActions` 负责队列、歌单、标签、元数据及删除/重载动作；列表保留数据筛选和集合播放。
- [x] `useFooterSwipe` 负责折叠播放栏的手势识别、队列预览冻结、切歌提交及计时清理；展开播放栏不消费折叠手势，取消手势不切歌。
- [x] `DspEffectEditor` 与 `dspEffectFields` 负责压缩器、延迟、混响、合唱、噪声门、相位器和限制器的参数及对应提交。
- [x] 单独提取声道矩阵、ReplayGain、前级增益、声场、Crossfeed 和脉冲响应编辑器。
- [x] 单独提取输出设备、播放速度、重采样和播放过渡设置。可滚动音频面板内的设备/模式/重采样 Select 使用 Teleport，避免下拉框被裁剪。
- [x] 保留设备的 backend + id 身份；IR 导入失败恢复原配置并回传错误，成功后清理错误。

Select 的宽度契约：`class="w-64"`、`class="w-full"`、`style="width: 20rem"` 等均作用于外层，内部实际按钮跟随；`min-w-*` 仍由调用方决定最小宽度。不要通过覆盖内部按钮宽度弥补外层布局。`.ep-select-root` 是外层公开类，`.ep-select` 是交互按钮，`.ep-select-options` 是选项面板。

音频主面板目前保留 DSP 链路编排、运行状态、EQ 编辑区和预设管理；底栏保留布局与菜单展示。拆分以独立业务变化为边界，未将全部视图强制改成纯展示组件。

## 验证与入口

首页视觉调整：统一欢迎区、模块标题、圆角与留白；歌单和推荐共用 `home-collection-grid` 自动换行网格，在相同窗口宽度下封面大小、列数与间距一致，数量较少时也保留相同列宽；概览图标保留主题色方框背景，榜单按内容宽度切换双列/单列；热力图自适应可用宽度。首页移除布局调整入口及歌单/榜单标题右侧数量。歌单真实歌曲数在封面左下角悬停或键盘聚焦时显示，触屏直接显示，包含空歌单和“我喜欢”。保留已保存的模块顺序、隐藏偏好和主题颜色。

`npm run test:home` 使用隔离数据渲染真实首页，检查桌面/窄屏溢出、歌单换行、方框图标、悬停歌曲数、入口移除、统计详情和统计开关，输出 `build/home-desktop-light.png`、`build/home-desktop-dark.png`、`build/home-desktop-details.png`、`build/home-playlist-hover.png` 与 `build/home-compact.png`。预览中的封面和曲库数据仅为测试样本。

本轮验证结果：完整构建通过；81 个相关代码文件 lint 零错误、零警告；60 项 Electron 集成检查通过；完整歌曲搜索回归通过。集成检查新增 Select 布局宽度、歌曲删除/队列同步、歌单身份、折叠手势、DSP 参数提交、同 ID 不同后端设备选择、IR 导入回滚。首轮的主题包、歌词动效和空闲任务回归记录保留。

- 开发环境访问 `#/dev/ui` 查看控件尺寸、禁用/只读、错误、加载、浮层和异步确认。
- `npm run build`：完整类型检查和构建。
- `npm run test:ui`：隐藏 Electron 真实 DOM 回归；先构建以提供实际 CSS。
- `npm run test:song-search`：搜索排序、IME、请求竞态、数据查询和 worker。
- `node scripts/test-custom-theme.mjs`、`node scripts/test-theme-package.mjs`：主题验证与资源包兼容。
- `node scripts/test-idle-work.mjs`、`node scripts/test-lyrics-motion.mjs`：可见性/空闲任务及歌词动效回归。

组件集成测试不是完整播放会话验收。Mica、真实播放状态、动态背景和不同主题的整页观感仍需在实际应用中做人工验收。

首页播放修复：歌单播放/暂停期间仍锁定重复操作，但推荐封面不再随临时禁用状态降低透明度，只有空推荐保持弱化展示。`test:home` 增加暂停/恢复请求尚未完成时切换当前歌曲的检查，验证推荐封面节点与透明度保持稳定、按钮正确解锁。曲末闪退由解码线程已结束但仍可 join 时被替换引起；原生 `play()` 在重启解码前先回收旧线程。`audio_backend_recovery` 使用真实解码器和可控模拟输出覆盖缓存尾段反复暂停/恢复、暂停后 seek 和下一首无缝衔接；新增用例在修复前触发 `std::terminate`，修复后通过。原生模块修改需要重建并重启应用才能生效。

播放页退出过渡：`PlayerPanelTransition` 单独管理显示状态与挂载状态。关闭时通过 `v-show` 保留内容完成淡出，在 `after-leave` 隐藏宿主后才卸载子组件，避免流体背景在离场开始时就释放 WebGL 上下文并清空画布。退出中重新打开会取消卸载、复用现有内容；完全关闭后释放资源。频谱随整页离场，不再提前移除；退出阶段的 Escape 不消费底层页面事件。`test:ui` 覆盖懒挂载、淡出中的画布保留、隐藏后清理、关闭重开、后续清理及减少动画偏好。

侧边栏展开/收起入口移至顶栏标识右侧、返回按钮前方，继续使用持久化的 `sidebarExpanded` 状态；卡片模式不显示此入口。顶栏按钮同步提示、图标方向和 `aria-expanded`，通过 `aria-controls` 关联侧边栏。侧边栏内部移除原入口及折叠状态下的空标题行。

进度拖动提交：底栏、沉浸播放页和轻量播放页共用 `useSeekProgress`。原生 `input` 只更新本地滑块和时间预览，`change` 在松手/键盘确认时发送一次实际 seek；播放位置回报和 seek 等待期间不会覆盖预览。取消拖动或失焦释放预览；拖动期间切歌会丢弃旧歌曲的跳转目标。歌词点击跳转与音量调整保持原交互。`test:ui` 覆盖连续拖动不调用 seek、位置回报不拉回滑块、松手仅提交一次、等待回执、取消、切歌和后续恢复。

全局搜索：Header 搜索按钮与 `openSearch` 快捷键动作共用根级 `GlobalSearchHost`，按需加载 `GlobalSearchDialog`。默认 `Ctrl+K`，可在快捷键设置中修改，也可自行配置系统全局快捷键；系统快捷键会先恢复并聚焦主窗口。普通页面、卡片模式和沉浸播放页共用一个弹窗；轻量模式提示先返回完整界面。初次打开仅展示搜索框，标题保留为无障碍名称；输入有效关键词后向下展开结果区域，清空或仅输入空白时收起，展开不移动搜索框。结果包含封面、歌名、歌手/专辑与时长；移除来源、标签、排序、刷新、批量操作和上下文菜单。通过 `querySongList` 复用歌曲页的索引检索及相关度，搜索全部来源且不修改歌曲页筛选；空输入不查询整页曲库。`playSearchResult` 共用于弹窗与歌曲页，按歌曲播放方式设置单击/双击，或聚焦结果后按 Enter/空格播放，复用原队列与歌单身份。首开聚焦搜索框，再次呼出选中关键词；Esc 关闭，导航后关闭，关闭时清理监听和过期请求。`npm run test:global-search` 检查真实 Header、快捷键、精简弹窗与虚拟列表，并输出 `build/global-search-desktop.png` 和 `build/global-search-compact.png`。

歌曲播放方式：播放设置新增单击/双击选项，默认双击，纳入 UI 偏好持久化与恢复默认。歌曲列表、首页排行、播放队列和全局搜索共用 useSongActivation，切换立即生效；单击模式忽略双击手势的后续事件，避免重复播放。嵌套按钮、链接和勾选控件不触发行播放，键盘激活与显式播放按钮保持直接播放。真实 DOM 检查覆盖事件顺序、模式切换、嵌套操作隔离；偏好检查覆盖默认值、恢复默认和重启还原。

卡片模式动画：参考旧版 CardView 的轻位移与缩放节奏。LayoutModeTransition 管理普通布局与卡片模式的先离后入，离场内容 inert，快速切换遵循最后一次选择；减少动画通过 CSS 时长处理，避免同步卸载时的重入冲突。卡片首次显示轻微上移淡入；useCardTransition 专门管理歌单内容退出/进入和取消恢复，默认退出 200ms、进入 400ms，沿用全局动画时长变量。useCardLibrary 移除请求前固定等待，新请求期间保留旧卡片，数据就绪后才等待离场并提交新集合；过期请求在等待动画后再次校验。取消、失败和卸载会释放动画，错误保留旧内容并恢复歌单选中项。拖动惯性仍按帧更新，不额外叠加 CSS 位移动画。test:card-motion 检查真实组件进出、慢请求、出入顺序、动画中再次选择、乱序响应、失败回退、减少动画及晚到请求清理，并输出桌面/窄窗口预览。
