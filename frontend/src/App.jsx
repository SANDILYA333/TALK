import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'
import { Button } from '@heroui/react';
import { ThemeProvider } from './context/ThemeContext';
import { WallpaperProvider } from './context/WallpaperContext';
import { Route,Routes } from 'react-router';
import {ChatPage} from "./pages/ChatPage.jsx"

function App() {
  return (
    <ThemeProvider> 
      <WallpaperProvider>
        <Routes>
          <Route path="/" element={<ChatPage/>}/>
          <Route path="/" element={<ChatPage/>}/>
        </Routes>
      </WallpaperProvider>
    </ThemeProvider>
  )
}

export default App