const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const cors = require("cors");
const ytdl = require("@distube/ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const axios = require('axios');
const path = require("path");
const FormData = require('form-data');
require('dotenv').config();

// Check for API Key
if (!process.env.API_KEY) {
  console.error("API_KEY not found in environment variables. Please check your .env file.");
  process.exit(1);
}

console.log("API key loaded:", process.env.API_KEY.substring(0, 5) + "..." + 
  (process.env.API_KEY.length > 10 ? process.env.API_KEY.substring(process.env.API_KEY.length - 5) : ""));

const app = express();
// Use environment variable for port (important for production)
const PORT = process.env.PORT || 5000;
const DATA_FILE = "./recipes.json";

// Add a data directory for recipes and temp files
const DATA_DIR = path.join(__dirname, 'data');
const TEMP_DIR = path.join(__dirname, 'temp');

// Create directories if they don't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for larger requests

// Add security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Add routes for serving recipes
app.get('/recipes', (req, res) => {
  try {
    const recipes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(recipes);
  } catch (error) {
    console.error('Error serving recipes:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes' });
  }
});

app.get('/recipes2', (req, res) => {
  try {
    const recipes = JSON.parse(fs.readFileSync('./recipes2.json', 'utf8'));
    res.json(recipes);
  } catch (error) {
    console.error('Error serving recipes2:', error);
    res.status(500).json({ error: 'Failed to retrieve recipes2' });
  }
});

// Home page
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
      
      <div class="endpoint">
        <h3>Process YouTube Recipe</h3>
        <p>URL: POST to /process-youtube</p>
        <p>Body: { "youtubeLink": "https://www.youtube.com/watch?v=..." }</p>
      </div>
    </body>
    </html>
  `);
});

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1';

// Add retry configuration
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000; // 2 seconds

// Add retry function
async function downloadWithRetry(url, options, retries = MAX_RETRIES) {
  try {
    return await ytdl(url, options);
  } catch (error) {
    if (error.statusCode === 403 && retries > 0) {
      console.log(`Retry attempt ${MAX_RETRIES - retries + 1} after 403 error...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return downloadWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

// Function to download and extract audio from YouTube video
async function downloadAndExtractAudio(url) {
  const videoId = ytdl.getVideoID(url);
  const audioPath = path.join(__dirname, `temp_${videoId}.mp3`);

  return new Promise((resolve, reject) => {
    try {
      const stream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly',
      });

      stream.on('error', (err) => {
        console.error('Error in ytdl stream:', err);
        reject(err);
      });

      ffmpeg(stream)
        .toFormat("mp3")
        .audioBitrate(128)  // Lower bitrate for smaller file
        .audioChannels(1)   // Mono audio
        .audioFrequency(16000)  // 16kHz sample rate
        .on("end", () => {
          console.log("Audio extraction completed");
          resolve(audioPath);
        })
        .on("error", (err) => {
          console.error("Error in ffmpeg:", err);
          reject(err);
        })
        .save(audioPath);

    } catch (error) {
      console.error("Error in downloadAndExtractAudio:", error);
      reject(error);
    }
  });
}

// Function to read audio file and convert to base64
function getAudioContent(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

// Function to create transcription using DeepSeek API
async function createTranscription(audioPath) {
  try {
    // Convert audio to base64
    const audioData = getAudioContent(audioPath);
    
    // Call DeepSeek API for transcription
    const response = await axios.post(
      `${DEEPSEEK_API_URL}/audio/transcriptions`,
      {
        model: "deepseek-whisper",  // Use appropriate DeepSeek model
        file: audioData,
        response_format: "text"
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.text || response.data;
  } catch (error) {
    console.error("Transcription error:", error.response?.data || error.message);
    
    // Fallback to direct text analysis if transcription fails
    console.log("Transcription failed. Proceeding with direct text analysis...");
    return "Transcription unavailable. Please analyze based on video title and common recipe patterns.";
  }
}

// Process YouTube link endpoint
app.post("/process-youtube", async (req, res) => {
  const { youtubeLink } = req.body;
  let audioPath = null;

  try {
    console.log("\n=== Starting YouTube Processing ===");
    console.log("Processing YouTube link:", youtubeLink);

    // Download audio
    console.log("\n1. Downloading audio...");
    audioPath = await downloadAndExtractAudio(youtubeLink);
    console.log("✓ Audio downloaded to:", audioPath);

    // Verify file exists and is readable
    if (!fs.existsSync(audioPath)) {
      throw new Error("Audio file not found after download");
    }

    const stats = fs.statSync(audioPath);
    console.log("✓ Audio file size:", stats.size, "bytes");

    // Get video title as fallback
    const videoInfo = await ytdl.getInfo(youtubeLink);
    const videoTitle = videoInfo.videoDetails.title;
    console.log("✓ Video title:", videoTitle);

    // Create transcript
    console.log("\n2. Creating transcript...");
    let transcription;
    try {
      transcription = await createTranscription(audioPath);
      console.log("✓ Transcription completed");
      console.log("Transcript preview:", transcription.substring(0, 150) + "...");
    } catch (error) {
      console.log("⚠️ Transcription failed, using video title as context");
      transcription = `Video title: ${videoTitle}. Please extract recipe details based on this title.`;
    }

    // Analyze with DeepSeek API
    console.log("\n3. Analyzing with DeepSeek API...");
    const completion = await axios.post(
      `${DEEPSEEK_API_URL}/chat/completions`,
      {
        model: "deepseek-chat", // Replace with appropriate DeepSeek model
        messages: [
          {
            role: "system",
            content: `You are a professional chef and recipe analyzer. You MUST extract:
            1. Recipe name and description
            2. Exact list of ingredients with measurements
            3. STEP-BY-STEP cooking instructions (this is mandatory)
            4. Total Nutritional information per serving based on the ingredients (calories, carbs, fats, proteins) be strict
            5. Author name of the recipe (who created or presented it)

            Never skip the cooking instructions - they are crucial.`
          },
          {
            role: "user",
            content: `Analyze this recipe and provide ALL details including MANDATORY step-by-step instructions. Format as JSON:
            {
              "name": "Recipe Name",
              "description": "Brief description",
              "author": "Name of the chef or creator",
              "ingredients": [
                "exact ingredient with measurement"
              ],
              "instructions": [
                "Step 1: Detailed instruction",
                "Step 2: Detailed instruction",
                "Step 3: Detailed instruction"
                // At least 5 detailed steps required
              ],
              "servings": number,
              "calories": number,
              "carbs": number,
              "fats": number,
              "proteins": number,
              "Time": "30 minutes"
            }

            Rules:
            1. Instructions array MUST be included and contain at least 5 detailed steps
            2. Each instruction step must start with "Step X: "
            3. Instructions must be detailed enough to cook the recipe
            4. All measurements must be specific
            5. All nutritional values must be numbers
            6. Always include the author/chef name who created or presented the recipe
            7. Include an estimated cooking time in the "Time" field

            Context: ${videoTitle}
            Transcript: ${transcription}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Process response
    const text = completion.data.choices[0].message.content;
    console.log("\n4. DeepSeek Response received:");
    console.log(text);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in response");
    }

    const recipeDetails = JSON.parse(jsonMatch[0]);
    const videoId = ytdl.getVideoID(youtubeLink);
    recipeDetails.url = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    // Save to recipes.json
    console.log("\n5. Saving to recipes.json...");
    const recipesPath = path.join(__dirname, 'recipes.json');
    
    let recipes = [];
    if (fs.existsSync(recipesPath)) {
      const fileContent = fs.readFileSync(recipesPath, 'utf8');
      recipes = fileContent ? JSON.parse(fileContent) : [];
    }

    // Generate new ID
    const maxId = recipes.reduce((max, recipe) => Math.max(max, recipe.id || 0), 0);
    recipeDetails.id = maxId + 1;

    recipes.push(recipeDetails);
    
    fs.writeFileSync(recipesPath, JSON.stringify(recipes, null, 2));
    console.log("✓ Recipe saved successfully");
    console.log("\nNew Recipe Details:");
    console.log(JSON.stringify(recipeDetails, null, 2));

    console.log("\n=== Processing Completed Successfully ===\n");
    res.json({ 
      id: recipeDetails.id,
      success: true,
      message: 'Recipe processed successfully' 
    });

  } catch (error) {
    console.error("\n❌ Error processing video:", error);
    console.error("Error details:", error.message);
    res.status(500).json({
      error: "Error processing video",
      details: error.message
    });
  } finally {
    // Clean up audio file
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
        console.log("\n✓ Cleaned up temporary audio file");
      } catch (err) {
        console.error("Error cleaning up file:", err);
      }
    }
  }
});

// Existing endpoints
app.get("/recipes", (req, res) => {
  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading recipes.json:", err);
      return res.status(500).send("Error reading data.");
    }
    res.send(JSON.parse(data));
  });
});

app.post("/recipes", (req, res) => {
  const newRecipe = req.body;

  fs.readFile(DATA_FILE, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading recipes.json:", err);
      return res.status(500).send("Error reading data.");
    }

    const recipes = JSON.parse(data);
    recipes.push(newRecipe);

    fs.writeFile(DATA_FILE, JSON.stringify(recipes, null, 2), (err) => {
      if (err) {
        console.error("Error writing to recipes.json:", err);
        return res.status(500).send("Error saving data.");
      }
      res.status(201).send("Recipe added successfully!");
    });
  });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});