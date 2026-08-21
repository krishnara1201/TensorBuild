import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCode, getNodes, runPipeline, resolveBaseUrl } from '../src/api/client'
import type { NodeManifest, PipelineIR } from '../src/api/types'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('api/client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getNodes fetches GET /nodes and returns parsed manifests', async () => {
    const manifests: NodeManifest[] = [
      {
        id: 'data.csv_loader',
        category: 'Data',
        label: 'CSV Loader',
        inputs: [],
        outputs: [{ name: 'table', type: 'Table' }],
        params: [],
        long_running: false,
      },
    ]
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => manifests,
    } as Response)

    const result = await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/nodes')
    expect(result).toEqual(manifests)
  })

  it('getNodes throws with the status on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)

    await expect(getNodes()).rejects.toThrow('GET /nodes failed: 500')
  })

  it('runPipeline POSTs the IR and returns metrics', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metrics: { 'n4.metrics': { accuracy: 0.9 } } }),
    } as Response)

    const result = await runPipeline(ir)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ir),
    })
    expect(result).toEqual({ metrics: { 'n4.metrics': { accuracy: 0.9 } } })
  })

  it('runPipeline throws the engine detail message on a 422', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'unknown node type' }),
    } as Response)

    await expect(runPipeline(ir)).rejects.toThrow('unknown node type')
  })

  it('getCode POSTs the IR and returns the generated script', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 'print(1)' }),
    } as Response)

    const result = await getCode(ir)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ir),
    })
    expect(result).toEqual({ code: 'print(1)' })
  })
})

describe('resolveBaseUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(invoke).mockReset()
  })

  it('uses the Tauri-provided base URL when invoke resolves', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('http://127.0.0.1:54321')

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:54321/nodes')
  })

  it('falls back to the default URL when invoke rejects (no Tauri context)', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no tauri context'))

    await resolveBaseUrl()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
    await getNodes()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/nodes')
  })
})
