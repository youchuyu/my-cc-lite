## Skills

能力边界：可复用的“能力包”，适合沉淀领域知识、流程、模板、脚本；不适合一次性任务或过宽职责。
实践原则：一个 Skill 只做一类事；description 必须写清“做什么 + 何时用”；大内容放 references/、templates/、scripts/
按需加载；有副作用的 Skill 用 disable-model-invocation: true。

## Hooks

能力边界：事件触发的自动化守卫/增强层，适合校验、拦截、脱敏、通知、权限决策；不适合承载复杂产品逻辑。
实践原则：输入输出走 JSON；能阻断的放 PreToolUse / Stop 等关键事件；脚本尽量确定性；涉及命令执行时优先最小权限、短
超时、清晰退出码。

## Agents / Subagents

能力边界：独立上下文里的专职执行者，适合复杂、多步、并行、长上下文或强专业分工任务；不适合简单单步任务。
实践原则：职责单一；提示词明确角色、优先级、输出格式；工具权限从只读和最小集开始；需要隔离探索用 fork/worktree，需
要长期知识再配置 memory。

## MCP / Tools

能力边界：连接外部实时系统/API/数据库/文件服务；适合“当前状态”和外部动作，不是静态记忆或普通项目规范。
实践原则：.mcp.json 可提交但密钥只能走环境变量；每个 server 最小权限、独立进程、可审计；优先 OAuth/只读 token；工具
描述和 always-load 要克制，避免上下文膨胀。

## Scripts

能力边界：本项目里主要是文档构建与质量校验工具，不是产品运行时。
实践原则：Markdown 是单一事实源；改文档后跑对应构建/校验；网络依赖主要在 EPUB Mermaid/Kroki 渲染；质量门包括 pre-
commit、pytest、ruff/mypy/bandit 等，失败应修根因不绕过。

一句话区分：Skills 定义可复用能力，Hooks 管控事件，Subagents 隔离执行，MCP/Tools 连接外部世界，Scripts 做确定性构建
与校验。
