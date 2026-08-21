import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import './index.css'
import { App } from './App'
import { resolveBaseUrl } from './api/client'

// Default retry (3 attempts with backoff) makes the "engine unreachable"
// error banner take several seconds to appear; one retry is enough to ride
// out a transient blip without stalling the palette on "Loading nodes…".
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('missing #root element')
  }

  await resolveBaseUrl()
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

bootstrap()
