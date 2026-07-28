# 苔原：Living World MVP

> 接手开发前请先阅读 [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md)，了解当前 ComputerScienceWorld 方块世界方向和最近增量；再阅读 [`docs/PROJECT_ANCHOR.md`](docs/PROJECT_ANCHOR.md)。

一个可互动的小聚落原型。居民会自行平衡饱腹、精力和社交需求；资源、天气与公共设施会改变他们的选择，也会累积为聚落故事。

## 试玩

需要 Node.js 22 或更新版本：

```bash
npm install
npm run dev
```

然后在浏览器打开终端显示的本地地址。

## 当前可玩内容

- 暂停与 1× / 2× / 4× 时间推进
- 八位拥有独立需求、关系和当前行为的居民
- 会变化的食物、木材、士气与事件日志
- 可建造公共厨房，改变资源与士气
- 可举办篝火聚会，重塑社交关系
- 可触发或结束旱灾，观察资源紧缺如何影响聚落

## 下一步可以尝试

1. 增加建筑、职业和配方，让聚落有经济分工。
2. 引入可保存的世界种子与回放。
3. 将居民决策开放为受限脚本或行为树，走向 Screeps/Battlecode 式创造。
4. 扩展记忆、家庭、组织与文化，形成更长的社会历史。

## 验证

```bash
npm run build
```
