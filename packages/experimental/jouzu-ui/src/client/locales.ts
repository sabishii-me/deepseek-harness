/** Locale-owned chrome; native payload text remains verbatim. */
export const en = {
  thinkingRecorded: 'Thinking', liveProgress: 'Jouzu live progress', liveThinking: 'Thinking…', liveWorking: 'Jouzu is working…',

  title: 'Jouzu', paused: 'Paused', work: 'Work', recordedWork: 'Last recorded state',
  delivery: 'Latest foreground turn', dispatchObserved: 'Dispatch attempted', ackObserved: 'Native command acknowledged', ackUnknown: 'Native acknowledgement not recorded', replyObserved: 'Assistant output recorded in this turn', replyUnknown: 'No assistant output recorded in this turn', turnInterrupted: 'Turn interrupted', turnFailed: 'Turn failed',
  needsYou: 'Needs your input', pending: 'Pending', lastRunning: 'Last observed running', exitCode: 'Exit code', duration: 'Duration', seconds: 's',
  taskCreate: 'Create tasks', taskUpdate: 'Update task', taskList: 'Tasks', background: 'Background execution',
  results: 'Recorded background results', success: 'Succeeded', failure: 'Failed', cancelled: 'Cancelled',
  running: 'Running', waiting: 'Waiting for dependencies', logReference: 'Native log file', omitted: 'Additional results', unrecognized: 'Unrecognized Flow details',
  inspect: 'Read Flow',
  inspecting: 'Reading…',
  recordedAt: 'Recorded at',
  diagnosticHint: 'Native report captured at the recorded time; relative ages are not live.',
  observed: 'Last native observation — not a live task inventory',
  unavailable: 'Native backend unavailable',
  closed: 'Native process closed',
  empty: 'No native status received. Send a message in this new Session to start Jouzu.',
  flow: 'Latest Flow context',
  notification: 'Native Flow diagnostic',
  status: 'Extension status',
  widgets: 'Text widgets',
  limits: 'Terminal component widgets are not exposed by Pi RPC. Foreground Stop does not cancel background tasks. Native questions appear in the existing composer.',
} as const
export type JouzuUiKey = keyof typeof en
export const zh: Record<JouzuUiKey, string> = {
  thinkingRecorded: '思考过程', liveProgress: 'Jouzu 实时进度', liveThinking: '正在思考…', liveWorking: 'Jouzu 正在处理…',

  title: 'Jouzu', paused: '已暂停', work: '工作进度', recordedWork: '最近记录状态',
  delivery: '最近前台轮次', dispatchObserved: '已尝试提交', ackObserved: '原生命令已确认', ackUnknown: '未记录原生命令确认', replyObserved: '此轮已记录助手输出', replyUnknown: '此轮未记录助手输出', turnInterrupted: '轮次已中断', turnFailed: '轮次失败',
  needsYou: '等待你处理', pending: '待处理', lastRunning: '最近记录为运行中', exitCode: '退出码', duration: '耗时', seconds: '秒',
  taskCreate: '创建任务', taskUpdate: '更新任务', taskList: '任务', background: '后台执行',
  results: '后台执行结果记录', success: '成功', failure: '失败', cancelled: '已取消',
  running: '执行中', waiting: '等待依赖', logReference: '原生日志文件', omitted: '其他结果', unrecognized: '未识别的 Flow 详情',
  inspect: '读取 Flow',
  inspecting: '读取中…',
  recordedAt: '记录时间',
  diagnosticHint: '以下为记录时的原生报告，其中相对时间不会实时更新',
  observed: '最近一次原生状态记录，并非实时任务清单',
  unavailable: '原生后端不可用',
  closed: '原生进程已关闭',
  empty: '尚未收到原生状态。在此新会话发送消息后启动 Jouzu。',
  flow: '最近的 Flow 上下文',
  notification: '原生 Flow 诊断',
  status: '扩展状态',
  widgets: '文本组件',
  limits: 'Pi RPC 不提供终端组件式 widget。前台停止不会取消后台任务。原生问题使用现有输入区交互。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { jouzu: JouzuUiKey }
}
