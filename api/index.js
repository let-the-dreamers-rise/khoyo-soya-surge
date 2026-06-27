// Vercel serverless entry. Re-exports the Express app as the function handler
// (an Express app is a valid (req, res) handler). server.js skips app.listen()
// when it detects a serverless environment.
import app from "../server.js";

export default app;
