import { defineConfig } from 'vite';

/**
 * GitHub Pages 部署要点：
 *
 * · Pages 是**纯静态**托管 —— 没有服务端，因此没有 API key 的安全存放处。
 *   本站据此设计：规则判分在浏览器内真跑；AI 判分退化为「离线骨架」或「自带 endpoint」。
 *
 * · 项目页的 URL 形如 https://<user>.github.io/<repo>/ ，资源必须用子路径。
 *   因此 base 由环境变量注入，CI 里设 BASE_PATH=/<repo>/；本地 dev 用 '/'。
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    /**
     * 关掉 modulepreload 的 polyfill。
     * 理由：它是给不支持 modulepreload 的老浏览器用的，代价是每个页面入口都注入一段
     * 依赖 MutationObserver 的代码。这是单产物静态页，用不到 —— 关掉更小、依赖更少
     * （也给冒烟测试省掉一个 DOM 依赖）。
     */
    modulePreload: false,
    // 单文件产物，方便 Pages 直接发布；也因此不能用动态 import 分包
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
  },
});
