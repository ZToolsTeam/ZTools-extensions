export type ContainerStatusFilter = 'all' | 'running' | 'exited'
export interface ContainerSummary {
  id: string; name: string; image: string; state: string; status: string; ports: string; createdAt: string
  cpu: string | null; memory: string | null
}
export interface DockerSnapshot { sessionId: string; context: string; containers: ContainerSummary[]; statsError: string | null }
export interface DockerLogs { stdout: string; stderr: string }
export const isStopped = (c: ContainerSummary) => ['created', 'exited', 'dead'].includes(c.state)
