import express from 'express'
import cors from 'cors'
import { chatRouter } from './routes/chat'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api', chatRouter)

const PORT = 3001
app.listen(PORT, () => {
  console.log(`BFF server running on http://localhost:${PORT}`)
})
