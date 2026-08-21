import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CodegenResult, NodeManifest, PipelineIR, RunResult } from './types'

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

async function postPipeline<T>(path: string, ir: PipelineIR): Promise<T> {
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
  return response.json()
}

export function runPipeline(ir: PipelineIR): Promise<RunResult> {
  return postPipeline<RunResult>('/pipeline/run', ir)
}

export function getCode(ir: PipelineIR): Promise<CodegenResult> {
  return postPipeline<CodegenResult>('/pipeline/codegen', ir)
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
