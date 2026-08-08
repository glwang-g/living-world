# 苔原：Living World（ComputerScienceWorld MVP）

> 接手开发前请先阅读 [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md)
> （最新增量）和 [`docs/PROJECT_ANCHOR.md`](docs/PROJECT_ANCHOR.md)（项目锚点）。

一个可以进入、观察、修改和回看的方块世界原型。玩家在 2D 方块空间里移动、挖掘、
放置和建造；世界有昼夜、怪物、火把与事件历史；权威规则由独立的 Rust 引擎
（`world-server`）裁决，浏览器只发送命令并渲染快照。

## 运行

需要 Node.js 22 或更新版本：

```bash
npm install
npm run world:server   # 启动权威 Rust 世界服务（监听 127.0.0.1:8787）
npm run dev            # 浏览器客户端
```

macOS 可注册为后台服务：

```bash
sh scripts/install-world-server-macos.sh
```

世界数据在 `engine/data/`：`world.snapshot` 是可恢复的当前快照，
`world.events.log` 是追加式事件记录。

## 当前可玩内容

- 方块空间：移动、挖掘、拾取、放置；天然资源与玩家建造结构有明确区分
- 昼夜循环（10 分钟一个世界日）与夜间怪物（视线、路径、火把驱赶）
- 角色 3 条命 × 5 HP；死亡、复苏与事件流由服务端统一裁决
- 世界持续推进：浏览器关闭后 `world-server` 仍在运行
- 事件流与历史视角：按天定位、双向翻页，可回看世界为何变成现在这样
- 世界档案：保存、读取、删除快照与完整事件流
- 生产部署：推送 `master` 自动发布到 <https://living.freexlib.com>

## 下一步方向（详见 PROJECT_ANCHOR）

1. 火把照明范围，让夜晚真正影响可见性
2. 信号与机关：开关 → 导线 → 门 → 可触发机关
3. 让居民/代理读取世界规则并行动
4. 统一事件流投影（角色视角 / 历史视角 / 代理视角）
5. 逐步走向可编程世界（Screeps/Battlecode 式）

## 验证

```bash
npm run build
cargo test --manifest-path engine/Cargo.toml
```

## 部署

`master` 推送自动部署到 `living.freexlib.com`。首次安装、Nginx 合并方式和
GitHub SSH Secret 配置见 [`docs/REMOTE_DEPLOYMENT.md`](docs/REMOTE_DEPLOYMENT.md)。
