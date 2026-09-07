import { ApprovalService } from './approvalService'

const approvalService = new ApprovalService()

async function testApprovalService() {
  console.log('准备请求 approval')

  const resultPromise = approvalService.request({
    id: 'test-1',
    toolCallId: 'call-1',
    toolName: 'write',
    args: { path: 'hello.txt', content: 'hello' },
  })

  console.log('Approval 已创建，现在应该处于等待状态')

  setTimeout(() => {
    console.log('模拟用户点击 Allow')

    approvalService.respond({ id: 'test-1', decision: 'allow' })
  }, 2000)

  const allowed = await resultPromise
  console.log('Approval result:', allowed)
}

void testApprovalService()
