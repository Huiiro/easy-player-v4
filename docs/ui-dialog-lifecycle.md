# Dialog 与 Drawer 生命周期

`BaseDialog` 和 `BaseDrawer` 共享 `useModalClose`，普通主题和 Liquid Glass 使用同一套过渡行为。

- 打开：首次挂载即为打开状态时也执行入场动画。`beforeEnter`、`afterEnter` 来自实际面板的过渡；依赖最终尺寸的初始化放在 `afterEnter`。
- 关闭请求：关闭按钮、Esc、遮罩和缓存页面停用共用关闭入口。同一轮交互只发送一次 `update:modelValue(false)` 和 `close`；父级可以拦截关闭来确认未保存内容。
- 退出：关闭时立即取消请求或使旧会话失效，但保留已显示的内容。面板和遮罩完成退出后由 `TransitionRoot` 卸载 Portal；内容重置及裁剪器销毁放在 `afterLeave`。
- 重开：退出中重新打开会中断退出，旧请求不得覆盖新会话。清理函数需避免清空已重新打开的内容。
- 清理：直接卸载时仍必须释放实例、订阅和请求。KeepAlive 停用即隐藏 Portal 并释放滚动锁，避免被父级拦截关闭后留在新页面上。
- 焦点：沿用 Headless UI 的焦点约束，Portal 卸载后焦点落在 body 时补充恢复原触发器；不覆盖其他弹窗或新页面已获得的焦点。

需要退出动画时，通过 `v-model` 关闭弹窗，避免父级在关闭同一帧使用 `v-if` 销毁整个业务组件。

验证：`npm run test:modal-lifecycle`。测试使用 Chromium 的实际 CSS 动画，覆盖初次打开、退出内容保留、焦点恢复、快速重开、KeepAlive 停用、过期数据、首次数据加载、裁剪器初始化/销毁和直接卸载。
