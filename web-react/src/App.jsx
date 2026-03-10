import { Outlet } from 'react-router-dom'
import ChatbotWidget from './components/ChatbotWidget'

function App() {
  return (
    <>
      <Outlet />
      <ChatbotWidget />
    </>
  )
}

export default App
