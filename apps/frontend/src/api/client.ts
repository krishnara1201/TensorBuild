import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CodegenResult, NodeManifest, PipelineIR, RunOutcome } from './types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'
let baseUrl = DEFAULT_BASE_URL

export async function resolveBaseUrl(): Promise<string> {
  try {
    baseUrl = await invoke<string>('engine_base_url')
  } catch {
    baseUrl = DEFAULT_BASE_URL
  }
  return baseUrl
}

export async function getNodes(): Promise<NodeManifest[]> {
  const response = await fetch(`${baseUrl}/nodes`)
  if (!response.ok) {
    throw new Error(`GET /nodes failed: ${response.status}`)
  }
  return response.json()
}

async function postPipeline(path: string, ir: PipelineIR): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ir),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail =
      body && typeof body.detail === 'string' ? body.detail : `${path} failed: ${response.status}`
    throw new Error(detail)
  }
  return { status: response.status, body: await response.json() }
}

export async function runPipeline(ir: PipelineIR): Promise<RunOutcome> {
  const { status, body } = await postPipeline('/pipeline/run', ir)
  if (status === 202) {
    return { kind: 'async', runId: (body as { run_id: string }).run_id }
  }
  return { kind: 'sync', metrics: (body as { metrics: Record<string, unknown> }).metrics }
}

export async function getCode(ir: PipelineIR): Promise<CodegenResult> {
  const { body } = await postPipeline('/pipeline/codegen', ir)
  return body as CodegenResult
}

export function getRunSocketUrl(runId: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/ws/runs/${runId}`
}

export function useNodes() {
  return useQuery({ queryKey: ['nodes'], queryFn: getNodes })
}

export function useRunPipeline() {
  return useMutation({ mutationFn: runPipeline })
}

export function useGetCode() {
  return useMutation({ mutationFn: getCode })
}
