import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'
import { Button } from '@heroui/react';

function App() {
  return (
    <> <h1 className="text-4xl text-red-500 bg-amber-300">MY APP</h1>

      <Button>Hello MF</Button>
      <header>
        <Show when="signed-out">
          <SignInButton mode="modal" />
          <SignUpButton mode="modal"  />
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>
    </>
  )
}

export default App