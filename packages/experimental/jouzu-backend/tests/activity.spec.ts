import { expect, it } from 'vitest'
import { appendPluginRecord, Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { foldActivity, type JouzuActivity } from '../src/activity.ts'
it('replays native receipts into tasks and jobs without committing failed task updates', () => {
  const id = SessionId('activity')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  let state: JouzuActivity = { tasks: [], jobs: [], waits: [], calls: [] }
  let index = 0
  const call = (name: string, args: object, text: string, isError = false, meta?: object) => {
    const callId = ToolCallId(String(++index))
    state = foldActivity(state, session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) }))
    state = foldActivity(state, session.append('tool/result', { turn: 1, step: 1,
      ...(meta ? { meta: JSON.parse(JSON.stringify(meta)) } : {}),
      message: createToolResultMessage({ callId, content: [{ type: 'text', text }], isError }),
    }, { surfaceOp: 'append' }))
  }
  call('TaskCreateMany', {}, 'Created 2 tasks:\n  #1 Build app\n  #2 Test app')
  call('TaskUpdate', { taskId: '1', status: 'completed' }, 'Updated task #1 status')
  call('TaskUpdate', { taskId: '2', status: 'completed' }, 'Rejected', true)
  expect(state.tasks).toEqual([{ id: '1', title: 'Build app', status: 'completed', waiting: false }, { id: '2', title: 'Test app', status: 'pending', waiting: false }])
  call('bg_task', {}, 'Started', false, { task: { id: 'bg-1', title: 'Build app', status: 'running', startedAt: 100, updatedAt: 100, flow: { work: { id: 'native-work' } } } })
  call('bg_task', {}, 'Failed', false, { task: { id: 'bg-1', title: 'Build app', status: 'failed', startedAt: 100, updatedAt: 1100, exitCode: 127 } })
  expect(state.jobs).toHaveLength(1)
  expect(state.jobs[0]).toMatchObject({ title: 'Build app', status: 'failed', exitCode: 127 })
  call('TaskCreate', { subject: 'Single', metadata: { flowControl: { waitForUser: true } } }, 'Task #3 created successfully: Single')
  expect(state.tasks.at(-1)).toMatchObject({ id: '3', title: 'Single', waiting: true })
  call('TaskList', {}, '#3 [pending] Single  <- next')
  expect(state.tasks).toEqual([{ id: '3', title: 'Single', status: 'pending', waiting: true }])
  call('TaskUpdate', { taskId: '3', status: 'deleted' }, 'Deleted task #3')
  expect(state.tasks[0]?.status).toBe('deleted')
  call('TaskList', {}, 'No tasks found')
  expect(state.tasks).toEqual([])
  expect(state.calls).toEqual([])
})

it('settles only the matching native execution from an autonomous Flow result', () => {
  const id = SessionId('activity-flow')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  const state: JouzuActivity = { tasks: [], waits: [], calls: [], jobs: [
    { id: 'bg-1', execution: 'execution-one', title: 'Build', status: 'running', startedAt: 1, updatedAt: 1, exitCode: null, work: null },
    { id: 'bg-2', execution: 'execution-two', title: 'Other', status: 'running', startedAt: 1, updatedAt: 1, exitCode: null, work: null },
  ] }
  appendPluginRecord(session, 'plugin:jouzu-backend/ui', { statuses: [], widgets: [], notification: null, lifecycle: 'observed', flow: JSON.stringify({ kind: 'result', content: { sample: [{ execution: 'execution-one', status: 'failure' }] } }) })
  // oxlint-disable-next-line typescript/no-deprecated -- Replay the committed native presentation event.
  const result = foldActivity(state, session.snapshotEvents().at(-1)!)
  expect(result.jobs.map(job => job.status)).toEqual(['failed', 'running'])
})

it('updates from bg_status without a completion wake and respects inventory, clear and reused ids', () => {
  const session=Session.create(SessionId('bg-status'))
  let state:JouzuActivity={ tasks:[],jobs:[],waits:[],calls:[] },i=0
  const receipt=(name:string,meta:object,isError=false)=>{
    const callId=ToolCallId(String(++i))
    state=foldActivity(state,session.append('tool/call',{ turn:1,step:1,callId,name,arguments:'{}' }))
    state=foldActivity(state,session.append('tool/result',{ turn:1,step:1,meta:JSON.parse(JSON.stringify(meta)),message:createToolResultMessage({ callId,content:[{ type:'text',text:'receipt' }],isError }) },{ surfaceOp:'append' }))
  }
  const first={ id:'bg-1',title:'demo slow job',status:'running',startedAt:100,updatedAt:100,flow:{ execution:'first' } }
  receipt('bg_task',{ action:'spawn',task:first })
  receipt('bg_status',{ action:'list',tasks:[{ ...first,status:'completed',updatedAt:200,exitCode:0 }] })
  expect(state.jobs[0]).toMatchObject({ status:'completed',exitCode:0 })
  receipt('bg_status',{ action:'log',task:first })
  expect(state.jobs[0]?.status).toBe('completed')
  receipt('bg_task',{ action:'clear',removed:1 })
  expect(state.jobs).toEqual([])
  const second={ ...first,startedAt:300,updatedAt:300,flow:{ execution:'second' } }
  receipt('bg_task',{ action:'spawn',task:second })
  receipt('bg_status',{ action:'log',task:{ ...first,status:'completed',updatedAt:400 } })
  expect(state.jobs[0]).toMatchObject({ execution:'second',status:'running' })
  receipt('bg_status',{ action:'list',tasks:{ version:2,fullSnapshot:false,taskIds:[] } })
  expect(state.jobs).toHaveLength(1)
  receipt('bg_status',{ action:'list',tasks:[] },true)
  expect(state.jobs).toHaveLength(1)
  receipt('bg_status',{ action:'list',tasks:[] })
  expect(state.jobs).toEqual([])
  expect(state.calls).toEqual([])
})
