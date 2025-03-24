const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Simple home route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Recipe API</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .endpoint { background: #f4f4f4; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>Recipe API</h1>
      <p>Welcome to the Recipe API. Use the following endpoints to access recipe data:</p>
      
      <div class="endpoint">
        <h3>Get All Recipes (recipes.json)</h3>
        <p>URL: <a href="/recipes">/recipes</a></p>
      </div>
      
      <div class="endpoint">
        <h3>Get Additional Recipes (recipes2.json)</h3>
        <p>URL: <a href="/recipes2">/recipes2</a></p>
      </div>
    </body>
    </html>
  `);
});

// Serve recipes.json
app.get('/recipes', (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'recipes.json');
    if (fs.existsSync(filePath)) {
      const recipes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.json(recipes);
    } else {
      res.status(404).json({ error: 'Recipes file not found' });
    }
  } catch (error) {
    console.error('Error serving recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes', details: error.message });
  }
});

// Serve recipes2.json
app.get('/recipes2', (req, res) => {
  try {
    const filePath = path.join(process.cwd(), 'recipes2.json');
    if (fs.existsSync(filePath)) {
      const recipes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.json(recipes);
    } else {
      res.status(404).json({ error: 'Recipes2 file not found' });
    }
  } catch (error) {
    console.error('Error serving recipes2:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes2', details: error.message });
  }
});

// Debug endpoint for Vercel troubleshooting
app.get('/debug', (req, res) => {
  try {
    res.json({
      environment: {
        node_env: process.env.NODE_ENV,
        vercel: process.env.VERCEL,
      },
      directory: {
        cwd: process.cwd(),
        files: fs.readdirSync(process.cwd()).slice(0, 20), // List first 20 files
      },
      recipes_exists: fs.existsSync(path.join(process.cwd(), 'recipes.json')),
      recipes2_exists: fs.existsSync(path.join(process.cwd(), 'recipes2.json')),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// For local development
const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app; 