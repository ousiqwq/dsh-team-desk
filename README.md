<h1 align="center">
  <img src="assets/avatar.png" width="124" height="124" align="center" alt="月兔少女头像">
  &nbsp;
  <img src="assets/wordmark.svg" width="330" align="center" alt="Team Desk · Multi-session collaboration for DeepSeek Harness">
</h1>

在 DeepSeek Harness 的同一个工作区并排打开团队会话。每个成员有独立的对话、职责和权限，可以接单、交流，并把结果交回派单人。

## 安装

适用于 **DSH 0.2.3-alpha.2** 和 **Node.js 26.13.1 或以上**（其实你装上去试试就行了）。从[私有预览发行页](https://github.com/ousiqwq/dsh-team-desk/releases/tag/v0.15.4-preview.1)下载 npm 安装包，在保存安装包的目录执行。两种方式任选其一。

**npx 一键安装**

```sh
npx --yes ./dsh-plugin-team-desk-0.15.4-preview.1.tgz install --profile web
```

**DSH CLI 安装**

```sh
dsh plugin --profile web add ./dsh-plugin-team-desk-0.15.4-preview.1.tgz && npx --yes ./dsh-plugin-team-desk-0.15.4-preview.1.tgz adapt
```

安装后重启 DSH，在会话右上角打开「团队协作」，选择预设并应用。自定义宿主目录可在 npx 命令末尾添加 `--host /path/to/host`。宿主适配作用于使用同一套 DSH 程序文件的所有配置。

## 团队预设

| 预设 | 成员 | 分工 |
| --- | --- | --- |
| 工作与监督 | 工作、监督 | 工作席负责实施与交付，监督席核对验收条件并反馈。 |
| 逆向工作流 | 统筹监督、静态分析、动态分析 | 统筹席分配任务。静态席分析结构和数据，动态席验证运行行为，两席可直接交流。 |
| 逆向工作流（四人） | 监督、工作、静态分析、动态分析 | 监督向工作席派单；工作席组织两路分析、整合结果，再交监督验收。 |

## 会话与协作

- 在左侧会话树切换成员，最多同时展示四个窗格。成员沿用各自的 DSH 对话模式与文件操作权限。
- 按成员间的连接派单、跟进和回传。在团队内查看任务状态、文件变更和异常记录。
- 归档主会话时，已绑定成员随团队归档；解除绑定后，成员可以作为独立会话继续使用。

## 灵魂插件联动

安装并启用 [Soul Desk · 私人灵魂](https://github.com/ousiqwq/dsh-soul-desk) 后，可在成员的「人设与权限」中选择会话人设和原生子代理的人设继承方式。Team Desk 独立提供团队会话与通信。

## 许可证

[MIT](LICENSE)
