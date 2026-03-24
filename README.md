# ICVN Project

当前项目已调整为纯前端模式，基于 `Next.js + React + Tailwind CSS + Floating UI`。

## 当前状态

- 已移除 `Supabase` 相关页面、路由、代理与依赖
- 已安装 `@floating-ui/react`
- 已提供一个可继续扩展的启动页面 UI
- 已保留最小必要的基础 UI 组件，方便后续继续加功能

## 启动开发

```bash
npm install
npm run dev
```

默认访问：`http://localhost:3000`

## 下一步建议

- 补充顶部导航或侧边导航
- 扩展首页信息卡片与模块入口
- 基于 `Floating UI` 增加菜单、提示、筛选面板或引导层
- 按业务需求逐步添加页面与状态管理
