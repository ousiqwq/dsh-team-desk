<h1 align="center">
  <img src="https://cdn.jsdelivr.net/npm/dsh-plugin-team-desk@0.15.5/assets/avatar.png" width="124" height="124" align="center" alt="月兔少女头像">
  &nbsp;
  <img src="https://cdn.jsdelivr.net/npm/dsh-plugin-team-desk@0.15.5/assets/wordmark.svg" width="330" align="center" alt="Team Desk · Multi-session collaboration for DeepSeek Harness">
</h1>

在 DeepSeek Harness 的同一个工作区并排打开团队会话。每个成员有独立的对话、职责和权限，可以接单、交流，并把结果交回派单人。

## 安装

使用 **Node.js 26.13.1 或以上**。已在 **DSH 0.2.3-alpha.2** 验证完整适配，其他 DSH 版本也可以直接尝试安装。安装器会列出当前宿主可用的适配和跳过的项目（dsh版本不对就试试嘛，试试嘛~）。三种安装方式任选其一。

**npm 一键安装（推荐）**

```sh
npm exec --yes --package=dsh-plugin-team-desk@latest -- dsh-team-desk install --profile web
```

**npx 一键安装**

```sh
npx --yes dsh-plugin-team-desk@latest install --profile web
```

**DSH CLI 一键安装**

```sh
dsh plugin --profile web add dsh-plugin-team-desk@latest && npx --yes dsh-plugin-team-desk@latest adapt
```

安装后重启 DSH。自定义宿主目录可在 `install` 或 `adapt` 命令末尾添加 `--host /path/to/host`。宿主适配作用于使用同一套 DSH 程序文件的所有配置。

## 打开团队，启用四窗

有两个入口，任选一个即可打开团队设置。

- **右上角双人图标**　先打开要管理的会话，再点击图标。
- **左侧会话列表**　右击普通会话，选择「创建团队」。右击已有团队的主会话或成员，选择「编辑此团队」。

首次组队时，在设置中点「创建团队」并确认，当前会话就成为主会话。在「切换预设」选择 **逆向工作流（四人）**，打开「同时应用预设排布」，再点 **应用到当前团队**。配置生效后点「查看窗口」，就能在四个窗格里分别对话。

![四个会话正在排查日历订阅异常。工作席发出两条派单，静态席收件后核对字段，动态席运行复现用例。标注分别指向右上角双人图标和左侧会话右键菜单，菜单摘图显示「创建团队」和「编辑此团队」。](https://cdn.jsdelivr.net/npm/dsh-plugin-team-desk@0.15.5/assets/previews/four-panes.png)

## 拖拽排布

- **添加分屏**　按住左侧会话列表中的成员，拖到目标窗格。蓝色预览会标出松开后的范围。下图把「复现订阅异常（动态分析）」拖到「核对日历字段（静态分析）」的下半部，出现「在此窗格下方添加」时松开。拖入同一工作目录的独立会话，也会把它加入团队。
- **交换位置**　四窗中，按住已显示窗格的标题，拖到另一窗格中央，松开即可交换位置。
- **替换窗格**　四窗已满时，从左侧拖入尚未显示的会话，会替换鼠标所在的窗格。被替换的会话仍在左侧列表。
- **放进右侧栏**　先展开右侧栏，再把会话拖进栏内。拖到对话区的最右边缘会调整分屏。

![从左侧会话树按住「复现订阅异常」，拖入「核对日历字段」下方的蓝色区域后松开。](https://cdn.jsdelivr.net/npm/dsh-plugin-team-desk@0.15.5/assets/previews/drag-to-split.png)

## 自建团队与预设

- **自己组队**　在主会话右上角点击双人图标，选择「创建团队」并确认。在「成员与会话」中添加成员，可以绑定已有会话，也可以新建会话。在「当前团队」配置每个人的职责、权限和通信关系后，点击「保存并应用」。
- **创建可复用的预设**　在「管理 → 预设库」点击「新建预设」，设置成员、主成员、通信关系和初始排布，再点「保存预设」。也可以在「当前团队」选择「另存为预设」。要在另一个团队使用，到该团队的「切换预设」中选择它，点击「应用到当前团队」。

## 内置团队预设

插件自带以下三套预设，可直接使用，也可以复制后修改。

| 预设 | 成员 | 分工 |
| --- | --- | --- |
| 工作与监督 | 工作、监督 | 工作席负责实施与交付，监督席核对验收条件并反馈。 |
| 逆向工作流 | 统筹监督、静态分析、动态分析 | 统筹席分配任务。静态席分析结构和数据，动态席验证运行行为，两席可直接交流。 |
| 逆向工作流（四人） | 监督、工作、静态分析、动态分析 | 监督向工作席派单；工作席组织两路分析、整合结果，再交监督验收。 |

## 会话与协作

- 成员沿用各自的 DSH 对话模式与文件操作权限。
- 按成员间的连接派单、跟进和回传。在团队内查看任务状态、文件变更和异常记录。
- 归档主会话时，已绑定成员随团队归档；解除绑定后，成员可以作为独立会话继续使用。

## 灵魂插件联动

安装并启用 [Soul Desk · 私人灵魂](https://github.com/ousiqwq/dsh-soul-desk) 后，可在成员的「人设与权限」中选择会话人设和原生子代理的人设继承方式。Team Desk 独立提供团队会话与通信。

## 许可证

[MIT](https://github.com/ousiqwq/dsh-team-desk/blob/main/LICENSE)
