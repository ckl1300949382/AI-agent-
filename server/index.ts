import express from 'express'
import cors from 'cors'
import { chatRouter } from './routes/chat'
import { runsRouter } from './routes/runs'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api', chatRouter)
app.use('/api', runsRouter)

const PORT = 3001
app.listen(PORT, () => {
  console.log(`BFF server running on http://localhost:${PORT}`)
})
