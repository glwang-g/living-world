# 生产部署：living.freexlib.com

目标机器：`ubuntu@living.freexlib.com`，项目目录：`/home/ubuntu/living-world`。

部署后由 Nginx 对外提供站点；浏览器访问同源 `/api/*`，Nginx 转发到仅监听本机 `127.0.0.1:8787` 的 Rust 世界服务。世界快照和档案保留在 `engine/data/`，自动发布不会删除它们。

## 一次性服务器安装

首次发布可以从空的 `/home/ubuntu/living-world` 开始。GitHub Actions 会同步代码，并自动安装 Node.js 22、Rust、构建工具和 Nginx，再完成以下安装。远端 `ubuntu` 用户需要无密码执行 `sudo`。

如需不经 GitHub Actions 手动安装，先运行：

```bash
cd /home/ubuntu/living-world
bash scripts/install-remote-prerequisites.sh
bash scripts/install-remote-services.sh
```

该脚本会注册并启动：

- `living-world-world.service`：权威 Rust 世界服务，端口仅限本机 `8787`；
- `living-world-web.service`：前端应用，端口仅限本机 `3000`；
- `deploy/nginx/living-world.conf`：把站点和 `/api/*` 分别转发给两个服务。

如果该域名已有 HTTPS 虚拟主机，不要额外启用仓库里的 HTTP `server` 块。把其中两个 `location` 块合并进现有的 `living.freexlib.com` HTTPS 配置，然后执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## GitHub 自动部署

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

| Secret | 值 |
| --- | --- |
| `LIVING_WORLD_DEPLOY_KEY` | 可登录 `ubuntu@living.freexlib.com` 的专用 SSH 私钥 |

将该密钥对应的公钥加入远端 `ubuntu` 用户的 `~/.ssh/authorized_keys`。该用户还需要无密码执行 `systemctl` 和 `nginx` 相关 `sudo` 命令。

之后每次推送到 `master`，`.github/workflows/deploy.yml` 会通过 `rsync` 同步精确的提交内容，执行构建，并重启两个服务。工作流明确排除 `engine/data/`，不会删除当前世界、事件记录或档案。

发布前还需要为 `living.freexlib.com` 配置一条指向这台 Ubuntu 机器公网 IP 的 DNS `A` 记录。首次发布会先提供 HTTP；如需 HTTPS，可在站点可访问后执行 `sudo certbot --nginx -d living.freexlib.com`。

## 排查

```bash
sudo systemctl status living-world-world.service living-world-web.service
journalctl -u living-world-world.service -u living-world-web.service -n 100 --no-pager
curl http://127.0.0.1:8787/api/snapshot
curl http://127.0.0.1:3000/
```
