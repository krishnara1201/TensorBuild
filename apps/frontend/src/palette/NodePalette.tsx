import type { DragEvent } from 'react'
import { useNodes } from '../api/client'
import type { NodeManifest } from '../api/types'

export function groupByCategory(manifests: NodeManifest[]): Map<string, NodeManifest[]> {
  const groups = new Map<string, NodeManifest[]>()
  for (const manifest of manifests) {
    const existing = groups.get(manifest.category) ?? []
    existing.push(manifest)
    groups.set(manifest.category, existing)
  }
  return groups
}

function handleDragStart(event: DragEvent, manifestId: string) {
  event.dataTransfer.setData('application/vmb-node-type', manifestId)
  event.dataTransfer.effectAllowed = 'move'
}

export function NodePalette() {
  const { data: manifests, isLoading, error } = useNodes()

  if (isLoading) {
    return (
      <aside className="node-palette">
        <p>Loading nodes…</p>
      </aside>
    )
  }

  if (error || !manifests) {
    return (
      <aside className="node-palette">
        <p className="error-banner">
          Can't reach engine at http://127.0.0.1:8000 — is it running?
        </p>
      </aside>
    )
  }

  const groups = groupByCategory(manifests)

  return (
    <aside className="node-palette">
      {Array.from(groups.entries()).map(([category, categoryManifests]) => (
        <div key={category}>
          <h3>{category}</h3>
          {categoryManifests.map((manifest) => (
            <div
              key={manifest.id}
              className="node-palette-item"
              draggable
              onDragStart={(event) => handleDragStart(event, manifest.id)}
            >
              {manifest.label}
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}
