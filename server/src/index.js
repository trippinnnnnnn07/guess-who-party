import { createGameServer } from './app.js'

const port = Number(process.env.PORT) || 3001
const { httpServer } = createGameServer()

httpServer.listen(port, () => {
  console.log(`Guess Who Party server is ready at http://localhost:${port}`)
})
