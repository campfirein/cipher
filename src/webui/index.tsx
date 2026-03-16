import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles/index.css'

const rootElement = document.querySelector('#root')
if (rootElement === null) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)
root.render(<App />)
