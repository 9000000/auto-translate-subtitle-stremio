# Stremio Auto Subtitle Translate Addon

This Stremio addon automatically translates subtitles from OpenSubtitles to your desired language using various translation providers.

## Features

- Fetches subtitles from OpenSubtitlesV3
- Configurable target language
- Queue system for processing translation requests
- Caching of translated subtitles for improved performance
- Automatic provider fallback
- Rate limit protection
- Provider rotation for optimal performance

## How it Works

This addon follows the following workflow:

1. Receives subtitle request from Stremio
2. Checks if translated subtitles exist in the database
3. If not found, fetches subtitles from OpenSubtitles
4. Adds subtitles to a queue for translation
5. Returns a placeholder message during translation processing
6. Saves translated subtitles upon completion

## Configuration

This addon can be configured via Stremio with the following options:

- **Provider**: Choose from Google Translate, ChatGPT (OpenAI Compatible), or DeepSeek API
- **API Key**: Required for ChatGPT and DeepSeek API
- **BASE URL**: Required for ChatGPT (not needed for DeepSeek)
  - ChatGPT: https://api.openai.com/v1/responses
  - Gemini: https://generativelanguage.googleapis.com/v1beta/openai/
  - OpenRouter: https://openrouter.ai/api/v1/chat/completions
- **Model Name**: 
  - ChatGPT: gpt-4o-mini (default)
  - DeepSeek: deepseek-chat (default)
- **Target Language**: Select your desired translation language

## Technical Details

- Built with Node.js
- Uses `stremio-addon-sdk` for Stremio integration
- Implements a queue system using `better-queue`
- Stores subtitles on the local file system

### Translation Providers

- **Google Translate**
  - Web scraping method
  - No API key required
  - Free to use

- **ChatGPT (Compatible API)**
  - Google Gemini
  - OpenRouter
  - Official OpenAI API
  - Requires API key

- **DeepSeek API**
  - Cost-effective AI translation
  - High-quality results
  - Requires API key from https://platform.deepseek.com

### Queue System

This addon uses a queue system to efficiently process translation requests:

- Implements `better-queue` to manage translation tasks
- Concurrent processing of subtitles
- Automatic retries on failure
- Progress tracking and status updates

### Storage

- Subtitles are stored on the local file system
- Organized by provider, language, and media ID
- Translations are cached for improved performance

### Translation Process

1. Subtitle files are parsed and split into chunks
2. Each chunk is translated using the selected provider
3. Translated chunks are reassembled while maintaining timing
4. The final subtitle file is saved in SRT format

## Installation

1. **Web Installation (Recommended)**

   - Open Stremio
   - Go to the following URL: In progress
   - Click "Install Addon"
   - Select your desired translation settings
   - Click "Install"
   - The addon will be automatically configured in Stremio

2. **Manual Installation**

   - Open Stremio
   - Navigate to Addons
   - Click the "Community Addons" tab
   - Paste this URL: In progress
   - Click "Install"

3. **Self-Hosting**

   ```bash
   # Clone the repository
   git clone https://github.com/HimAndRobot/stremio-translate-subtitle-by-geanpn.git
   cd stremio-auto-translate

   # Install dependencies
   npm install

   # Create necessary directories
   mkdir -p debug subtitles data

   # Create a .env file from .env.example
   cp .env.example .env

   # Edit .env file with your configuration
   # For DeepSeek API, set:
   # PROVIDER=DeepSeek API
   # API_KEY=your_deepseek_api_key

   # Start the addon
   npm
